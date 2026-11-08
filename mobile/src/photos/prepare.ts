import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import { takenAtFromExif } from "./exif";

/**
 * A photo ready to queue: shrunk to at most 2,000 px on its long side (the
 * size the web uploads too), saved as a JPEG in the app's own folder so it
 * survives until it is sent, with the capture time read from the original
 * before shrinking.
 */
export type PreparedPhoto = { path: string; takenAt: string | null; width: number; height: number };

const MAX_SIDE = 2000;

function queueDir(): Directory {
  const dir = new Directory(Paths.document, "outbox-photos");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export async function preparePhoto(asset: ImagePickerAsset): Promise<PreparedPhoto> {
  const takenAt = takenAtFromExif(asset.exif ?? null);
  const ctx = ImageManipulator.manipulate(asset.uri);
  const long = Math.max(asset.width, asset.height);
  if (long > MAX_SIDE) {
    ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  // The name the CRM shows: when it was taken, plus a few characters so two
  // photos in the same second never collide.
  const dest = new File(queueDir(), `${photoName(takenAt)} ${Crypto.randomUUID().slice(0, 4)}.jpg`);
  new File(saved.uri).move(dest);
  return { path: dest.uri, takenAt, width: saved.width, height: saved.height };
}

/** "Photo 2026-11-08 12-08-10" in the phone's local time (no ":" — not allowed in file names everywhere). */
export function photoName(takenAt: string | null, now: Date = new Date()): string {
  const d = takenAt ? new Date(takenAt) : now;
  const p = (n: number) => String(n).padStart(2, "0");
  return `Photo ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Remove a queued photo's file once it has been sent or discarded. */
export function deleteQueuedPhoto(path: string): void {
  try {
    const f = new File(path);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}
