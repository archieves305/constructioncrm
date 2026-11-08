import { UPLOAD_MAX_BYTES, UPLOAD_MIME } from "@crm/mobile-api";

/** What a document picked on the phone may be, by the CRM's own rules. Pure. */
const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
};

/** The type the CRM will see: the picker's, else from the extension. */
export function docType(name: string, given: string | null | undefined): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const t = given && (UPLOAD_MIME as readonly string[]).includes(given) ? given : BY_EXTENSION[ext] ?? null;
  return t && (UPLOAD_MIME as readonly string[]).includes(t) ? t : null;
}

/** Why the CRM would refuse it, in words; null when it is fine. */
export function docProblem(name: string, size: number | null | undefined, type: string | null): string | null {
  if (!type) return `${name}: that file type can't be added (photos, PDF, Word, Excel, text or CSV)`;
  if (size === 0) return `${name} is empty`;
  if (size != null && size > UPLOAD_MAX_BYTES) return `${name} is over the ${UPLOAD_MAX_BYTES / 1024 / 1024} MB limit`;
  return null;
}

/** A name safe on every file system, keeping the extension. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(-120) || "Document";
}

