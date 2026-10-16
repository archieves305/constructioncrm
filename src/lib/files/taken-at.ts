// When a photo was taken, as sent by the browser (read from the camera's EXIF
// before the photo is downscaled, which strips it). Anything that is not a
// plausible date — unparseable, before 2000, or more than a day ahead — is
// dropped rather than trusted: a wrong date would misplace the photo in the
// project's timeline, and the upload day is the honest fallback.
const EARLIEST = Date.UTC(2000, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseTakenAt(raw: unknown, now: Date = new Date()): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const at = new Date(raw.trim());
  const ms = at.getTime();
  if (Number.isNaN(ms) || ms < EARLIEST || ms > now.getTime() + DAY_MS) return null;
  return at;
}
