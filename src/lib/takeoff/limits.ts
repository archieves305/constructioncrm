/**
 * What a plan set upload may be. Client-safe so the uploader can refuse a file
 * before anything is sent; the documents route enforces the same rules.
 *
 * Plan sets are far larger than ordinary attachments (the 3310 NE 37th set is
 * 20 MB for 34 sheets), so they get their own ceiling on their own route: 95 MB
 * sits under Cloudflare's 100 MB per-request limit. The generic file route keeps
 * its 25 MB. nginx must allow this on `/api/plan-sets/` (an operator change).
 */
export const MAX_PLAN_UPLOAD_BYTES = 95 * 1024 * 1024;

/** A set longer than this is split before upload; per-page steps keep each one small. */
export const MAX_PLAN_PAGES = 150;

/** A page with fewer text runs AND fewer drawn segments than these is a scan: manual mode only. */
export const RASTER_TEXT_MIN = 20;
export const RASTER_SEGMENT_MIN = 50;

/** Drawn segments kept per page, longest first, so a hatched sheet cannot bloat the store. */
export const MAX_SEGMENTS_PER_PAGE = 60_000;

export function planUploadProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) return `${file.name} is empty`;
  if (file.size > MAX_PLAN_UPLOAD_BYTES) return `${file.name} is over the ${MAX_PLAN_UPLOAD_BYTES / 1024 / 1024} MB limit — split the set and upload it in parts`;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return `${file.name}: a plan set must be a PDF`;
  return null;
}

export function isRasterPage(textItems: number, segments: number): boolean {
  return textItems < RASTER_TEXT_MIN && segments < RASTER_SEGMENT_MIN;
}
