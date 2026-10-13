import type { DocumentConfidentiality, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { decryptBlob, encryptBlob, isFieldEncryptionConfigured } from "@/lib/crypto/field-encryption";
import { deleteFile, fileExists, readFile, saveFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { isDayKey, todayKey } from "@/lib/time/zone";
import { settleDocumentAlerts } from "./document-alert-run";
import { PartnerError } from "./errors";
import { daysUntil } from "./qualification-state";
import { canClassifyVault, canReadDocument, canUploadRestricted, type VaultViewer } from "./vault-access";

/**
 * KNU's document vault: the licences, certificates, tax forms and company
 * papers a GC asks for. Versioned and append-only per type — the current
 * version is the highest. A RESTRICTED document's bytes are encrypted at
 * rest under the field keyring and served only by the audited download.
 */

const aadFor = (id: string) => `company-document:${id}`;

export function parseDocDay(value: string | null | undefined, field: string): Date | null {
  const v = value?.trim();
  if (!v) return null;
  if (!isDayKey(v)) throw new PartnerError(400, `${field} must be a date (yyyy-MM-dd)`);
  return new Date(`${v}T12:00:00.000Z`);
}

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export const DOC_SELECT = {
  id: true,
  documentTypeId: true,
  title: true,
  version: true,
  effectiveDate: true,
  expiresAt: true,
  confidentiality: true,
  approvedForExternal: true,
  supersedesId: true,
  notes: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  storageKey: true,
  encryptedKeyVersion: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: PERSON,
  documentType: { select: { id: true, key: true, name: true, category: true } },
  _count: { select: { requirements: true } },
} satisfies Prisma.CompanyDocumentSelect;

type DocRow = Prisma.CompanyDocumentGetPayload<{ select: typeof DOC_SELECT }>;

/** The wire shape: no storage key; `locked` when the viewer may not open it; `missing` when the bytes are gone. */
export type DocumentView = Omit<DocRow, "storageKey" | "encryptedKeyVersion" | "_count"> & { encrypted: boolean; locked: boolean; missing: boolean; current: boolean; daysLeft: number | null; usedByCount: number };

async function present(rows: DocRow[], viewer: VaultViewer, currentIds: Set<string>): Promise<DocumentView[]> {
  const today = todayKey();
  return Promise.all(
    rows.map(async (r) => {
      const { storageKey, encryptedKeyVersion, _count, ...rest } = r;
      const locked = !canReadDocument(viewer, r.confidentiality);
      return { ...rest, encrypted: encryptedKeyVersion !== null, locked, missing: locked ? false : !(await fileExists(storageKey)), current: currentIds.has(r.id), daysLeft: daysUntil(r.expiresAt, today), usedByCount: _count.requirements };
    }),
  );
}

export type VaultTypeView = { id: string; key: string; name: string; category: string; defaultValidityMonths: number | null; isActive: boolean; sortOrder: number; current: DocumentView | null; versions: DocumentView[] };

/** Every active type with its current version and history, grouped for the vault page. */
export async function listVault(viewer: VaultViewer, opts: { includeInactiveTypes?: boolean } = {}): Promise<{ types: VaultTypeView[]; canUpload: boolean; canClassify: boolean; canReadRestricted: boolean }> {
  const [types, docs] = await Promise.all([
    prisma.companyDocumentType.findMany({ where: opts.includeInactiveTypes ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.companyDocument.findMany({ orderBy: [{ documentTypeId: "asc" }, { version: "desc" }], select: DOC_SELECT }),
  ]);
  const currentIds = new Set<string>();
  const byType = new Map<string, DocRow[]>();
  for (const d of docs) {
    const list = byType.get(d.documentTypeId) ?? [];
    if (list.length === 0) currentIds.add(d.id);
    list.push(d);
    byType.set(d.documentTypeId, list);
  }
  const views = await present(docs, viewer, currentIds);
  const viewById = new Map(views.map((v) => [v.id, v]));
  return {
    types: types.map((t) => {
      const versions = (byType.get(t.id) ?? []).map((d) => viewById.get(d.id)!);
      return { id: t.id, key: t.key, name: t.name, category: t.category, defaultValidityMonths: t.defaultValidityMonths, isActive: t.isActive, sortOrder: t.sortOrder, current: versions[0] ?? null, versions };
    }),
    canUpload: canUploadRestricted(viewer) || (viewer.role !== null && viewer.role !== undefined && ["ADMIN", "MANAGER", "OFFICE_STAFF"].includes(viewer.role)),
    canClassify: canClassifyVault(viewer.role),
    canReadRestricted: canReadDocument(viewer, "RESTRICTED"),
  };
}

/** The current version of every type, for pickers: "attach the current GL COI". */
export async function currentDocuments(): Promise<DocRow[]> {
  const docs = await prisma.companyDocument.findMany({ orderBy: [{ documentTypeId: "asc" }, { version: "desc" }], select: DOC_SELECT });
  const seen = new Set<string>();
  return docs.filter((d) => (seen.has(d.documentTypeId) ? false : (seen.add(d.documentTypeId), true)));
}

export type UploadInput = {
  documentTypeKey: string;
  title?: string | null;
  effectiveDate?: string | null;
  expiresAt?: string | null;
  confidentiality?: DocumentConfidentiality;
  approvedForExternal?: boolean;
  notes?: string | null;
};

export async function uploadDocument(input: UploadInput, file: { buffer: Buffer; name: string; mime: string }, viewer: VaultViewer & { id: string }) {
  const type = await prisma.companyDocumentType.findUnique({ where: { key: input.documentTypeKey } });
  if (!type) throw new PartnerError(400, "documentTypeKey: unknown document type");
  const confidentiality = input.confidentiality ?? "INTERNAL";
  if (confidentiality === "RESTRICTED") {
    if (!canUploadRestricted(viewer)) throw new PartnerError(403, "Only someone who may read restricted documents can file one");
    if (!isFieldEncryptionConfigured()) throw new PartnerError(503, "Restricted documents need FIELD_ENCRYPTION_KEYS to be configured");
  }
  if (input.approvedForExternal && !canClassifyVault(viewer.role)) throw new PartnerError(403, "Only a manager can mark a document approved for external distribution");
  const effectiveDate = parseDocDay(input.effectiveDate, "Effective date");
  const expiresAt = parseDocDay(input.expiresAt, "Expiry date");
  if (effectiveDate && expiresAt && expiresAt < effectiveDate) throw new PartnerError(400, "The expiry date is before the effective date");

  const last = await prisma.companyDocument.findFirst({ where: { documentTypeId: type.id }, orderBy: { version: "desc" }, select: { id: true, version: true } });
  const version = (last?.version ?? 0) + 1;
  const id = `cd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const encrypted = confidentiality === "RESTRICTED" ? encryptBlob(file.buffer, aadFor(id)) : null;
  const stored = await saveFile(encrypted?.data ?? file.buffer, encrypted ? `${file.name}.enc` : file.name);
  try {
    const doc = await prisma.companyDocument.create({
      data: {
        id,
        documentTypeId: type.id,
        title: input.title?.trim() || `${type.name} v${version}`,
        version,
        effectiveDate,
        expiresAt,
        confidentiality,
        approvedForExternal: Boolean(input.approvedForExternal),
        supersedesId: last?.id ?? null,
        notes: input.notes?.trim() || null,
        fileName: file.name,
        fileType: file.mime,
        fileSize: file.buffer.byteLength,
        storageKey: stored.storageKey,
        encryptedKeyVersion: encrypted?.keyVersion ?? null,
        uploadedByUserId: viewer.id,
      },
      select: DOC_SELECT,
    });
    await recordAudit({ actorUserId: viewer.id, entityType: "CompanyDocument", entityId: doc.id, action: "document_upload", after: { type: type.key, version, title: doc.title, confidentiality, approvedForExternal: doc.approvedForExternal, expiresAt, fileName: file.name, encrypted: Boolean(encrypted) } });
    await settleDocumentAlerts(viewer.id, "A newer version was filed in the vault");
    return (await present([doc], viewer, new Set([doc.id])))[0]!;
  } catch (err) {
    await deleteFile(stored.storageKey).catch(() => undefined);
    throw err;
  }
}

export type DocumentPatch = { title?: string; effectiveDate?: string | null; expiresAt?: string | null; notes?: string | null; confidentiality?: DocumentConfidentiality; approvedForExternal?: boolean };

export async function updateDocument(id: string, patch: DocumentPatch, viewer: VaultViewer & { id: string }) {
  const before = await prisma.companyDocument.findUnique({ where: { id }, select: DOC_SELECT });
  if (!before) throw new PartnerError(404, "Document not found");
  if (!canReadDocument(viewer, before.confidentiality)) throw new PartnerError(404, "Document not found");
  const classifying = patch.confidentiality !== undefined || patch.approvedForExternal !== undefined;
  if (classifying && !canClassifyVault(viewer.role)) throw new PartnerError(403, "Only a manager can change a document's confidentiality");
  const data: Prisma.CompanyDocumentUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title.trim() || before.title;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  if (patch.effectiveDate !== undefined) data.effectiveDate = parseDocDay(patch.effectiveDate, "Effective date");
  if (patch.expiresAt !== undefined) data.expiresAt = parseDocDay(patch.expiresAt, "Expiry date");
  const effective = (data.effectiveDate === undefined ? before.effectiveDate : data.effectiveDate) as Date | null;
  const expires = (data.expiresAt === undefined ? before.expiresAt : data.expiresAt) as Date | null;
  if (effective && expires && expires < effective) throw new PartnerError(400, "The expiry date is before the effective date");
  if (patch.approvedForExternal !== undefined) data.approvedForExternal = patch.approvedForExternal;

  // Moving into or out of RESTRICTED re-writes the bytes under the keyring.
  let newStorageKey: string | null = null;
  if (patch.confidentiality !== undefined && patch.confidentiality !== before.confidentiality) {
    const toRestricted = patch.confidentiality === "RESTRICTED";
    const fromRestricted = before.confidentiality === "RESTRICTED";
    if (toRestricted && !isFieldEncryptionConfigured()) throw new PartnerError(503, "Restricted documents need FIELD_ENCRYPTION_KEYS to be configured");
    if (toRestricted && !canReadDocument(viewer, "RESTRICTED")) throw new PartnerError(403, "You could not open it once it is restricted");
    if (toRestricted !== fromRestricted) {
      const plain = await readDocumentBytes(before);
      const next = toRestricted ? encryptBlob(plain, aadFor(id)) : null;
      const stored = await saveFile(next?.data ?? plain, next ? `${before.fileName}.enc` : before.fileName);
      newStorageKey = stored.storageKey;
      data.storageKey = stored.storageKey;
      data.encryptedKeyVersion = next?.keyVersion ?? null;
    }
    data.confidentiality = patch.confidentiality;
  }

  const after = await prisma.companyDocument.update({ where: { id }, data, select: DOC_SELECT });
  if (newStorageKey) await deleteFile(before.storageKey).catch((err) => logger.exception(err, { where: "partners.updateDocument.unlink", id }));
  const keys = Object.keys(patch) as (keyof DocumentPatch)[];
  await recordAudit({
    actorUserId: viewer.id,
    entityType: "CompanyDocument",
    entityId: id,
    action: patch.confidentiality !== undefined && patch.confidentiality !== before.confidentiality ? "confidentiality_change" : patch.approvedForExternal !== undefined && patch.approvedForExternal !== before.approvedForExternal ? "approved_for_external" : "update",
    before: Object.fromEntries(keys.map((k) => [k, (before as Record<string, unknown>)[k]])),
    after: patch,
  });
  await settleDocumentAlerts(viewer.id, "A vault document's dates were corrected");
  const currentIds = new Set((await currentDocuments()).map((d) => d.id));
  return (await present([after], viewer, currentIds))[0]!;
}

/** Row first, then the file. Refused while any qualification requirement points at it. */
export async function deleteDocument(id: string, viewer: VaultViewer & { id: string }) {
  const doc = await prisma.companyDocument.findUnique({ where: { id }, select: DOC_SELECT });
  if (!doc) throw new PartnerError(404, "Document not found");
  if (!canClassifyVault(viewer.role)) throw new PartnerError(403, "Only a manager can delete a vault document");
  if (doc._count.requirements > 0) throw new PartnerError(409, `This version is attached to ${doc._count.requirements} qualification requirement${doc._count.requirements === 1 ? "" : "s"}; detach it there first`, { usedBy: doc._count.requirements });
  await prisma.$transaction(async (tx) => {
    await tx.companyDocument.updateMany({ where: { supersedesId: id }, data: { supersedesId: doc.supersedesId } });
    await tx.companyDocument.delete({ where: { id } });
  });
  await recordAudit({ actorUserId: viewer.id, entityType: "CompanyDocument", entityId: id, action: "delete", before: { type: doc.documentType.key, version: doc.version, title: doc.title, confidentiality: doc.confidentiality, fileName: doc.fileName } });
  await deleteFile(doc.storageKey).catch((err) => logger.exception(err, { where: "partners.deleteDocument", id }));
  await settleDocumentAlerts(viewer.id, "A vault document was removed");
}

/** The plain bytes, decrypted when the row says they are encrypted. Throws when the file is gone. */
export async function readDocumentBytes(doc: { id: string; storageKey: string; encryptedKeyVersion: number | null }): Promise<Buffer> {
  const raw = await readFile(doc.storageKey);
  return doc.encryptedKeyVersion === null ? raw : decryptBlob(raw, aadFor(doc.id));
}

export async function getDocumentForDownload(id: string, viewer: VaultViewer) {
  const doc = await prisma.companyDocument.findUnique({ where: { id }, select: { id: true, fileName: true, fileType: true, storageKey: true, encryptedKeyVersion: true, confidentiality: true, title: true, documentType: { select: { key: true } } } });
  if (!doc || !canReadDocument(viewer, doc.confidentiality)) return null;
  return doc;
}

/** The qualifications a document is attached to — what "replace it" has to reach. */
export async function usedBy(docId: string) {
  const rows = await prisma.qualificationRequirement.findMany({
    where: { companyDocumentId: docId },
    select: { id: true, status: true, qualification: { select: { id: true, status: true, platform: true, organization: { select: { id: true, name: true } } } } },
  });
  return rows.map((r) => ({ requirementId: r.id, requirementStatus: r.status, qualificationId: r.qualification.id, qualificationStatus: r.qualification.status, platform: r.qualification.platform, organization: r.qualification.organization }));
}

export async function listDocumentTypes(includeInactive = false) {
  return prisma.companyDocumentType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function upsertDocumentType(input: { id?: string; key?: string; name: string; category: string; defaultValidityMonths?: number | null; isActive?: boolean; sortOrder?: number }, actorUserId: string) {
  if (input.id) {
    const before = await prisma.companyDocumentType.findUnique({ where: { id: input.id } });
    if (!before) throw new PartnerError(404, "Document type not found");
    const after = await prisma.companyDocumentType.update({ where: { id: input.id }, data: { name: input.name.trim(), category: input.category, defaultValidityMonths: input.defaultValidityMonths ?? null, isActive: input.isActive ?? before.isActive, sortOrder: input.sortOrder ?? before.sortOrder } });
    await recordAudit({ actorUserId, entityType: "CompanyDocumentType", entityId: after.id, action: "update", before, after });
    return after;
  }
  const key = (input.key ?? input.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!key) throw new PartnerError(400, "Give the document type a name");
  const clash = await prisma.companyDocumentType.findUnique({ where: { key } });
  if (clash) throw new PartnerError(409, `"${clash.name}" already exists`);
  const max = await prisma.companyDocumentType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.companyDocumentType.create({ data: { key, name: input.name.trim(), category: input.category, defaultValidityMonths: input.defaultValidityMonths ?? null, isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
  await recordAudit({ actorUserId, entityType: "CompanyDocumentType", entityId: created.id, action: "create", after: created });
  return created;
}
