/**
 * What an upload may be. Client-safe (no node imports) so a picker can refuse
 * a file before anything is sent; `POST /api/files` enforces the same rules.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

/** Why this file would be refused, in words for the person; null when it is fine. */
export function uploadProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) return `${file.name} is empty`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`;
  if (!ALLOWED_MIME.has(file.type)) return `${file.name}: that file type cannot be attached (photos, PDF, Word, Excel, text or CSV)`;
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
