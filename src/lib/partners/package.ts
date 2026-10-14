import { zipSync } from "fflate";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { fileExists } from "@/lib/files/storage";
import { todayKey } from "@/lib/time/zone";
import { readDocumentBytes } from "./documents";
import { PartnerError } from "./errors";
import { contentsSheet, entryName, planPackage, safeName, type PackageDoc, type PackageLine, type PackagePlan } from "./package-plan";
import { canReadDocument, type VaultViewer } from "./vault-access";

/**
 * Phase 8 — the prequalification package: one zip with the vault documents a
 * GC's checklist asks for, led by a contents sheet. `planPackage` decides;
 * this loads, reads the bytes (decrypting RESTRICTED ones) and writes the
 * audit trail — one row for the package and one `document_view` per
 * restricted document, as the single-document download does.
 */

const DOC = { id: true, title: true, version: true, fileName: true, confidentiality: true, approvedForExternal: true, expiresAt: true, storageKey: true, encryptedKeyVersion: true, documentTypeId: true } as const;
type StoredDoc = { id: string; title: string; version: number; fileName: string; confidentiality: PackageDoc["confidentiality"]; approvedForExternal: boolean; expiresAt: Date | null; storageKey: string; encryptedKeyVersion: number | null; documentTypeId: string };

async function load(qualificationId: string) {
  const q = await prisma.qualification.findUnique({
    where: { id: qualificationId },
    select: {
      id: true,
      platform: true,
      organization: { select: { id: true, name: true } },
      requirements: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, required: true, status: true, documentTypeId: true, documentType: { select: { name: true } }, companyDocument: { select: DOC } } },
    },
  });
  if (!q) throw new PartnerError(404, "Qualification not found");
  const typeIds = [...new Set(q.requirements.map((r) => r.documentTypeId))];
  const docs = await prisma.companyDocument.findMany({ where: { documentTypeId: { in: typeIds } }, orderBy: [{ documentTypeId: "asc" }, { version: "desc" }], select: DOC });
  const current = new Map<string, StoredDoc>();
  for (const d of docs) if (!current.has(d.documentTypeId)) current.set(d.documentTypeId, d);
  return { q, current };
}

export type PackagePreview = PackagePlan & { organizationName: string; platform: string | null; canReadRestricted: boolean; fileName: string };

async function plan(qualificationId: string, viewer: VaultViewer, includeRestricted: boolean) {
  const { q, current } = await load(qualificationId);
  const byId = new Map<string, StoredDoc>();
  const existsCache = new Map<string, boolean>();
  const view = async (d: StoredDoc | null): Promise<PackageDoc | null> => {
    if (!d) return null;
    byId.set(d.id, d);
    if (!existsCache.has(d.id)) existsCache.set(d.id, await fileExists(d.storageKey));
    return { id: d.id, title: d.title, version: d.version, fileName: d.fileName, confidentiality: d.confidentiality, approvedForExternal: d.approvedForExternal, expiresAt: d.expiresAt, missing: !existsCache.get(d.id) };
  };
  const lines: PackageLine[] = [];
  for (const r of q.requirements) {
    lines.push({ requirementId: r.id, typeName: r.documentType.name, required: r.required, status: r.status, attached: await view(r.companyDocument), current: await view(current.get(r.documentTypeId) ?? null) });
  }
  const canReadRestricted = canReadDocument(viewer, "RESTRICTED");
  const p = planPackage(lines, { today: todayKey(), canReadRestricted, includeRestricted: includeRestricted && canReadRestricted });
  const fileName = `${safeName(`KNU prequalification - ${q.organization.name}`, 100)} - ${todayKey()}.zip`;
  return { q, byId, preview: { ...p, organizationName: q.organization.name, platform: q.platform, canReadRestricted, fileName } satisfies PackagePreview };
}

export async function previewPackage(qualificationId: string, viewer: VaultViewer, includeRestricted: boolean): Promise<PackagePreview> {
  return (await plan(qualificationId, viewer, includeRestricted)).preview;
}

export async function buildPackage(qualificationId: string, viewer: VaultViewer & { id: string; name: string }, includeRestricted: boolean, request: { ip: string | null; userAgent: string | null }) {
  const { q, byId, preview } = await plan(qualificationId, viewer, includeRestricted);
  if (preview.included === 0) throw new PartnerError(409, "Nothing on this checklist can be sent yet");
  const brand = await prisma.roofingBrand.findUnique({ where: { id: "default" }, select: { companyName: true } }).catch(() => null);
  const files: Record<string, Uint8Array> = {};
  files["00 - Contents.txt"] = new TextEncoder().encode(contentsSheet(preview, { companyName: brand?.companyName || "KNU Construction", organizationName: q.organization.name, platform: q.platform, preparedBy: viewer.name, preparedOn: todayKey() }));
  let n = 0;
  const sent: { id: string; title: string; version: number; restricted: boolean }[] = [];
  for (const item of preview.items) {
    if (!item.included || !item.doc) continue;
    const stored = byId.get(item.doc.id)!;
    let bytes: Buffer;
    try {
      bytes = await readDocumentBytes(stored);
    } catch {
      throw new PartnerError(410, `${item.typeName}: the file went missing while the package was assembled`);
    }
    n += 1;
    // Numbered in checklist order, so two entries never share a name.
    files[entryName(n, item.typeName, stored.fileName)] = new Uint8Array(bytes);
    sent.push({ id: stored.id, title: stored.title, version: stored.version, restricted: item.restricted });
  }
  // Already-compressed formats dominate (PDF, JPEG); store them as they are.
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.endsWith(".txt") ? 6 : 0 }]])) as Parameters<typeof zipSync>[0]);

  await recordAudit({ actorUserId: viewer.id, entityType: "Qualification", entityId: q.id, action: "qualification_package", after: { organizationId: q.organization.id, documents: sent, leftOut: preview.items.filter((i) => !i.included).map((i) => ({ type: i.typeName, reason: i.reason })) }, ipAddress: request.ip, userAgent: request.userAgent });
  for (const s of sent.filter((x) => x.restricted)) {
    await recordAudit({ actorUserId: viewer.id, entityType: "CompanyDocument", entityId: s.id, action: "document_view", after: { title: s.title, via: "qualification_package", qualificationId: q.id }, ipAddress: request.ip, userAgent: request.userAgent });
  }
  return { zip, fileName: preview.fileName, preview };
}
