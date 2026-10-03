/**
 * One photo gallery for a job, from two sources that stay where they are:
 * daily-log photos (`FieldPhoto`) and image files on the job (`File` — photos
 * taken from a task, images uploaded on the Files tab). Pure and client-safe:
 * the route loads both, this merges them newest first and says where each one
 * came from.
 */

export type GallerySource = "log" | "file";

export type GalleryItem = {
  /** Unique across both sources. */
  key: string;
  source: GallerySource;
  id: string;
  /** Where the image bytes are served. */
  url: string;
  fileName: string;
  /** The day it belongs to (a log photo's log day; a file's upload day in the office's zone). */
  day: string;
  /** For ordering within a day. */
  at: string;
  /** A daily-log photo's category (Progress, Before…); null for a file. */
  category: string | null;
  caption: string | null;
  area: string | null;
  by: { firstName: string; lastName: string };
  /** Where it came from, in words: "Daily log · Sep 3", "Task · Final walkthrough", "Uploaded". */
  origin: string;
  /** Where to go to see it in context, or null. */
  href: string | null;
  dailyLogId: string | null;
  taskId: string | null;
  /** The stored image is gone; the record is kept so it can be uploaded again. */
  missing: boolean;
};

export type LogPhotoRow = {
  id: string;
  /** yyyy-MM-dd */
  photoDate: string;
  createdAt: Date | string;
  category: string;
  caption: string | null;
  areaText: string | null;
  fileName: string;
  dailyLogId: string | null;
  jobArea: { name: string } | null;
  takenBy: { firstName: string; lastName: string };
  missing: boolean;
};

export type FilePhotoRow = {
  id: string;
  fileName: string;
  createdAt: Date | string;
  /** The upload day in the office's zone, yyyy-MM-dd. */
  day: string;
  taskId: string | null;
  task: { id: string; title: string } | null;
  uploadedBy: { firstName: string; lastName: string };
  missing: boolean;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function logPhotoItem(jobId: string, p: LogPhotoRow): GalleryItem {
  return {
    key: `log:${p.id}`,
    source: "log",
    id: p.id,
    url: `/api/photos/${p.id}/raw`,
    fileName: p.fileName,
    day: p.photoDate,
    at: iso(p.createdAt),
    category: p.category,
    caption: p.caption,
    area: p.jobArea?.name ?? p.areaText,
    by: p.takenBy,
    origin: `Daily log · ${shortDay(p.photoDate)}`,
    href: p.dailyLogId ? `/jobs/${jobId}/daily-logs/${p.photoDate}` : null,
    dailyLogId: p.dailyLogId,
    taskId: null,
    missing: p.missing,
  };
}

export function filePhotoItem(jobId: string, f: FilePhotoRow): GalleryItem {
  return {
    key: `file:${f.id}`,
    source: "file",
    id: f.id,
    url: `/api/files/${f.id}`,
    fileName: f.fileName,
    day: f.day,
    at: iso(f.createdAt),
    category: null,
    caption: null,
    area: null,
    by: f.uploadedBy,
    origin: f.task ? `Task · ${f.task.title}` : "Uploaded",
    href: f.task ? `/tasks?task=${f.task.id}` : `/jobs/${jobId}?tab=files`,
    dailyLogId: null,
    taskId: f.taskId,
    missing: f.missing,
  };
}

/** Both sources as one list, newest day first, then newest within the day. */
export function mergeGallery(jobId: string, logPhotos: readonly LogPhotoRow[], files: readonly FilePhotoRow[]): GalleryItem[] {
  return [...logPhotos.map((p) => logPhotoItem(jobId, p)), ...files.map((f) => filePhotoItem(jobId, f))].sort(
    (a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at) || a.key.localeCompare(b.key),
  );
}

export type GalleryFilter = { source?: GallerySource | null; category?: string | null; missingOnly?: boolean };

/** A daily-log category narrows to daily-log photos: a file has no such category. */
export function filterGallery(items: readonly GalleryItem[], f: GalleryFilter): GalleryItem[] {
  return items.filter((i) => (!f.source || i.source === f.source) && (!f.category || i.category === f.category) && (!f.missingOnly || i.missing));
}

/** Image types the gallery shows. HEIC cannot be drawn by a browser, but the record still belongs here. */
export const isGalleryImage = (fileType: string | null | undefined) => (fileType ?? "").toLowerCase().startsWith("image/");
