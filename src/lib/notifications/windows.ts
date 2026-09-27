import { TZDate } from "@date-fns/tz";
import { addLocalDays, isWeekdayIn, localDateKey, localParts } from "@/lib/nurture/time";

/**
 * Digest window arithmetic in the company time zone. Pure and DST-safe.
 *
 * A window key is "YYYY-MM-DD:HH:MM" in local time. Keys sort
 * lexicographically in time order, which is what lets the tick select
 * "every pending row scheduled for this window or any earlier one" with a
 * single `<=` and no per-user bookkeeping.
 */

export type WindowSettings = {
  timeZone: string;
  digestWindows: string[];
  weekdaysOnly: boolean;
  catchUpGraceMinutes: number;
};

export type DigestWindow = { key: string; hhmm: string; scheduledFor: Date };

export type DigestSlot = "morning" | "midday" | "afternoon" | "evening";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHMM(s: string): boolean {
  return HHMM.test(s);
}

export function sortedWindows(windows: string[]): string[] {
  return Array.from(new Set(windows.filter(isValidHHMM))).sort();
}

export function windowKey(localDate: string, hhmm: string): string {
  return `${localDate}:${hhmm}`;
}

/** The instant a window opens on the local calendar day that `dayRef` falls on. */
export function windowStartAt(dayRef: Date, hhmm: string, tz: string): Date {
  const p = localParts(dayRef, tz);
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(new TZDate(p.year, p.month, p.day, h, m, 0, 0, tz).getTime());
}

function allowedDay(d: Date, s: WindowSettings): boolean {
  return !s.weekdaysOnly || isWeekdayIn(d, s.timeZone);
}

function windowOn(day: Date, hhmm: string, tz: string): DigestWindow {
  return { key: windowKey(localDateKey(day, tz), hhmm), hhmm, scheduledFor: windowStartAt(day, hhmm, tz) };
}

/**
 * The window that is due right now: the latest one that has opened today and
 * is still inside the catch-up grace period. Null outside every window (or on
 * a weekend when weekdays-only is on). A tick that runs every 10 minutes
 * sees each window a handful of times; the digest ledger stops repeats.
 */
export function dueWindow(now: Date, s: WindowSettings): DigestWindow | null {
  if (!allowedDay(now, s)) return null;
  const windows = sortedWindows(s.digestWindows);
  let due: DigestWindow | null = null;
  for (const hhmm of windows) {
    const w = windowOn(now, hhmm, s.timeZone);
    const age = now.getTime() - w.scheduledFor.getTime();
    if (age >= 0 && age <= s.catchUpGraceMinutes * 60_000) due = w;
  }
  return due;
}

/**
 * Where a new digest row goes: the next window (today or on the next allowed
 * day) among the ones this person wants. An empty `userWindows` means every
 * company window; a subset that matches nothing falls back to all of them so
 * a stale preference never strands rows.
 */
export function nextWindow(now: Date, s: WindowSettings, userWindows: string[] = []): DigestWindow {
  const company = sortedWindows(s.digestWindows);
  const wanted = sortedWindows(userWindows).filter((w) => company.includes(w));
  const windows = wanted.length > 0 ? wanted : company;
  if (windows.length === 0) {
    // No windows configured at all: park rows on the next allowed 08:00.
    return nextWindow(now, { ...s, digestWindows: ["08:00"] }, []);
  }
  if (allowedDay(now, s)) {
    for (const hhmm of windows) {
      const w = windowOn(now, hhmm, s.timeZone);
      if (w.scheduledFor.getTime() > now.getTime()) return w;
    }
  }
  let day = addLocalDays(now, 1, s.timeZone);
  for (let guard = 0; guard < 14; guard++) {
    if (allowedDay(day, s)) return windowOn(day, windows[0]!, s.timeZone);
    day = addLocalDays(day, 1, s.timeZone);
  }
  return windowOn(day, windows[0]!, s.timeZone);
}

/** The morning window is the first of the day; producers of "due today" rows target it. */
export function firstWindowOn(day: Date, s: WindowSettings): DigestWindow | null {
  const windows = sortedWindows(s.digestWindows);
  if (windows.length === 0) return null;
  return windowOn(day, windows[0]!, s.timeZone);
}

/** Which of the day's windows a given one is, for the email's headline. */
export function slotOf(hhmm: string, windows: string[]): DigestSlot {
  const sorted = sortedWindows(windows);
  const idx = sorted.indexOf(hhmm);
  const n = sorted.length;
  if (idx < 0 || n <= 1) return "morning";
  if (idx === 0) return "morning";
  if (idx === n - 1) return "evening";
  return idx / (n - 1) < 0.5 ? "midday" : "afternoon";
}

export const SLOT_LABEL: Record<DigestSlot, string> = {
  morning: "Morning digest",
  midday: "Midday digest",
  afternoon: "Afternoon digest",
  evening: "End-of-day digest",
};

/** Dedupe bucket for non-digest rows: one per local hour (immediate) or local day (in-app). */
export function hourBucket(now: Date, tz: string): string {
  const p = localParts(now, tz);
  return `${localDateKey(now, tz)}T${String(p.hour).padStart(2, "0")}`;
}

export function dayBucket(now: Date, tz: string): string {
  return localDateKey(now, tz);
}
