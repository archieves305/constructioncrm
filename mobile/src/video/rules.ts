import { VIDEO_MAX_BYTES } from "@crm/mobile-api";

/**
 * Videos from the phone. Pure. Every video is shrunk on the phone before it
 * is queued (video/prepare.ts): 720p on its long side at about 2.5 Mbit/s,
 * roughly 20 MB a minute, with its location left out — so five minutes fits
 * the CRM's 95 MB limit for a video.
 */
export const VIDEO_MAX_SECONDS = 5 * 60;
export const VIDEO_LONG_SIDE = 1280;
export const VIDEO_BITRATE = 2_500_000;

/** "Video 2026-11-08 14-05-09.mp4" in the phone's local time. */
export function videoName(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Video ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}.mp4`;
}

/** Why a picked video can't be sent, in words; null when it is fine. Duration in seconds. */
export function videoTooLong(durationSeconds: number | null | undefined): string | null {
  if (durationSeconds == null) return null;
  return durationSeconds > VIDEO_MAX_SECONDS + 1 ? `That video is ${Math.round(durationSeconds / 60)} minutes. Videos can be up to ${VIDEO_MAX_SECONDS / 60} minutes: trim it in Photos first.` : null;
}

/** After shrinking: still over the CRM's limit? */
export function videoTooBig(bytes: number): string | null {
  return bytes > VIDEO_MAX_BYTES ? `Even shrunk, that video is ${Math.round(bytes / 1024 / 1024)} MB; the limit is ${VIDEO_MAX_BYTES / 1024 / 1024} MB. Trim it shorter in Photos.` : null;
}

/** "2:05" for a duration in seconds. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
