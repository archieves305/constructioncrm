import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { deleteFile, saveFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { isDayKey } from "@/lib/time/zone";
import type { VendorDocumentType } from "@/generated/prisma/client";
import { settleVendorAlerts } from "./alert-run";
import { VendorError } from "./service";

export const VENDOR_DOC_TYPES = ["GL_INSURANCE", "WORKERS_COMP", "WC_EXEMPTION", "W9", "LICENSE", "OTHER"] as const;

export type DocumentFields = {
  type?: VendorDocumentType;
  carrier?: string | null;
  policyNumber?: string | null;
  /** "yyyy-MM-dd", "" or null. */
  effectiveDate?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
};

const clean = (v: string | null | undefined) => v?.trim() || null;

/** A day from a date input, stored pinned at noon UTC. Empty clears it; anything else is refused. */
export function parseDocDay(value: string | null | undefined, field: string): Date | null {
  const v = value?.trim();
  if (!v) return null;
  if (!isDayKey(v)) throw new VendorError(400, `${field} must be a date`);
  return new Date(`${v}T12:00:00.000Z`);
}

export const DOCUMENT_SELECT = {
  id: true,
  type: true,
  carrier: true,
  policyNumber: true,
  effectiveDate: true,
  expiresAt: true,
  fileName: true,
  fileSize: true,
  notes: true,
  createdAt: true,
  uploadedBy: { select: { firstName: true, lastName: true } },
} as const;

export async function createDocument(
  vendorId: string,
  fields: DocumentFields & { type: VendorDocumentType },
  file: { buffer: Buffer; name: string; mime: string } | null,
  actorUserId: string,
) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new VendorError(404, "Vendor not found");
  const effectiveDate = parseDocDay(fields.effectiveDate, "Effective date");
  const expiresAt = parseDocDay(fields.expiresAt, "Expiry date");
  if (effectiveDate && expiresAt && expiresAt < effectiveDate) throw new VendorError(400, "The expiry date is before the effective date");

  const stored = file ? await saveFile(file.buffer, file.name) : null;
  const doc = await prisma.vendorDocument.create({
    data: {
      vendorId,
      type: fields.type,
      carrier: clean(fields.carrier),
      policyNumber: clean(fields.policyNumber),
      effectiveDate,
      expiresAt,
      notes: clean(fields.notes),
      fileName: file?.name ?? null,
      fileType: file?.mime ?? null,
      fileSize: stored?.bytes ?? null,
      storageKey: stored?.storageKey ?? null,
      uploadedByUserId: actorUserId,
    },
    select: DOCUMENT_SELECT,
  });
  await recordAudit({ actorUserId, entityType: "VendorDocument", entityId: doc.id, action: "create", after: { vendorId, type: doc.type, expiresAt: doc.expiresAt, fileName: doc.fileName } });
  await settleVendorAlerts(vendorId, actorUserId, "A newer document was added on the vendor");
  return doc;
}

export async function updateDocument(vendorId: string, docId: string, fields: DocumentFields, actorUserId: string) {
  const before = await prisma.vendorDocument.findFirst({ where: { id: docId, vendorId } });
  if (!before) throw new VendorError(404, "Document not found");
  const data: Record<string, unknown> = {};
  if (fields.type !== undefined) data.type = fields.type;
  if (fields.carrier !== undefined) data.carrier = clean(fields.carrier);
  if (fields.policyNumber !== undefined) data.policyNumber = clean(fields.policyNumber);
  if (fields.notes !== undefined) data.notes = clean(fields.notes);
  if (fields.effectiveDate !== undefined) data.effectiveDate = parseDocDay(fields.effectiveDate, "Effective date");
  if (fields.expiresAt !== undefined) data.expiresAt = parseDocDay(fields.expiresAt, "Expiry date");
  const effective = (data.effectiveDate === undefined ? before.effectiveDate : data.effectiveDate) as Date | null;
  const expires = (data.expiresAt === undefined ? before.expiresAt : data.expiresAt) as Date | null;
  if (effective && expires && expires < effective) throw new VendorError(400, "The expiry date is before the effective date");

  const doc = await prisma.vendorDocument.update({ where: { id: docId }, data, select: DOCUMENT_SELECT });
  await recordAudit({
    actorUserId,
    entityType: "VendorDocument",
    entityId: docId,
    action: "update",
    before: { type: before.type, expiresAt: before.expiresAt, effectiveDate: before.effectiveDate },
    after: { type: doc.type, expiresAt: doc.expiresAt, effectiveDate: doc.effectiveDate },
  });
  await settleVendorAlerts(vendorId, actorUserId, "The document's dates were changed on the vendor");
  return doc;
}

/** Row first, then the file — a failed unlink leaves an orphan on disk, never a row pointing at nothing. */
export async function deleteDocument(vendorId: string, docId: string, actorUserId: string): Promise<void> {
  const doc = await prisma.vendorDocument.findFirst({ where: { id: docId, vendorId } });
  if (!doc) throw new VendorError(404, "Document not found");
  await prisma.vendorDocument.delete({ where: { id: docId } });
  await recordAudit({ actorUserId, entityType: "VendorDocument", entityId: docId, action: "delete", before: { vendorId, type: doc.type, expiresAt: doc.expiresAt, fileName: doc.fileName } });
  if (doc.storageKey) {
    try {
      await deleteFile(doc.storageKey);
    } catch (err) {
      logger.exception(err, { where: "vendors.deleteDocument", docId });
    }
  }
  await settleVendorAlerts(vendorId, actorUserId, "The document was removed from the vendor");
}
