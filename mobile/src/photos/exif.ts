/**
 * When a photo was taken, from the camera's EXIF (pure; tested).
 *
 * `DateTimeOriginal` is "2026:11:08 14:03:22" in the camera's local time;
 * `OffsetTimeOriginal` ("-05:00"), when present, says which zone. Without it
 * the time is read as the phone's own local time. The CRM drops dates before
 * 2000 or more than a day ahead (parseTakenAt), so a wrong camera clock does no
 * harm.
 */
export function takenAtFromExif(exif: Record<string, unknown> | null): string | null {
  if (!exif) return null;
  const raw =
    pick(exif, "DateTimeOriginal") ??
    pick(exif, "{Exif}", "DateTimeOriginal") ??
    pick(exif, "DateTimeDigitized") ??
    pick(exif, "DateTime");
  if (typeof raw !== "string") return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const offset = pick(exif, "OffsetTimeOriginal") ?? pick(exif, "{Exif}", "OffsetTimeOriginal");
  if (typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

function pick(obj: Record<string, unknown>, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
