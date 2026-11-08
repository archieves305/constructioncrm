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

/**
 * Videos are taken only as job (or customer) files — never as receipts,
 * vendor or permit documents — through POST /api/files, with their own limit:
 * the CRM and nginx take a request of up to 100 MB, so a video of 95 MB at
 * most (the phone app sends 720p, a few minutes long).
 */
export const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;

export const isVideoType = (type: string | null | undefined) => VIDEO_MIME.has((type ?? "").toLowerCase());

/** Why this job file would be refused: videos by their own rules, everything else as uploadProblem. */
export function jobFileProblem(file: { name: string; size: number; type: string }): string | null {
  if (!isVideoType(file.type)) {
    const p = uploadProblem(file);
    return p ? p.replace("(photos, PDF, Word, Excel, text or CSV)", "(photos, videos, PDF, Word, Excel, text or CSV)") : null;
  }
  if (file.size === 0) return `${file.name} is empty`;
  if (file.size > MAX_VIDEO_BYTES) return `${file.name} is over the ${MAX_VIDEO_BYTES / 1024 / 1024} MB limit for a video`;
  return null;
}
