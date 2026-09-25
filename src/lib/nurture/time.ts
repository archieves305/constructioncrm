// Send-window arithmetic in the customer's time zone. Pure; DST-safe via
// @date-fns/tz's TZDate (a Date whose calendar fields are read in `tz`).

import { TZDate } from "@date-fns/tz";
import type { NurtureContentKind } from "@/generated/prisma/enums";

export type SendWindow = { startHour: number; endHour: number; timeZone: string; weekdaysOnly: boolean };

type Parts = { year: number; month: number; day: number; hour: number; weekday: number };

export function localParts(d: Date, tz: string): Parts {
  const z = new TZDate(d.getTime(), tz);
  return { year: z.getFullYear(), month: z.getMonth(), day: z.getDate(), hour: z.getHours(), weekday: z.getDay() };
}

export function isWeekdayIn(d: Date, tz: string): boolean {
  const w = localParts(d, tz).weekday;
  return w >= 1 && w <= 5;
}

export function isInWindow(d: Date, w: SendWindow): boolean {
  if (w.weekdaysOnly && !isWeekdayIn(d, w.timeZone)) return false;
  const h = localParts(d, w.timeZone).hour;
  return h >= w.startHour && h < w.endHour;
}

/** That local calendar day at the window's start hour, with the right offset for the date. */
export function windowStartOn(dayInTz: Date, w: SendWindow): Date {
  const p = localParts(dayInTz, w.timeZone);
  return new Date(new TZDate(p.year, p.month, p.day, w.startHour, 0, 0, 0, w.timeZone).getTime());
}

/** `earliest` if it is already inside the window; otherwise the next allowed day's window start. */
export function nextSendSlot(earliest: Date, w: SendWindow): Date {
  if (isInWindow(earliest, w)) return earliest;
  const p = localParts(earliest, w.timeZone);
  // Before today's window opens → today; otherwise tomorrow.
  let candidate = p.hour < w.startHour ? windowStartOn(earliest, w) : windowStartOn(addLocalDays(earliest, 1, w.timeZone), w);
  if (w.weekdaysOnly) {
    let guard = 0;
    while (!isWeekdayIn(candidate, w.timeZone) && guard++ < 7) candidate = windowStartOn(addLocalDays(candidate, 1, w.timeZone), w);
  }
  return candidate;
}

/** Calendar days in `tz`, keeping the local clock time (23h / 25h across DST, not 24). */
export function addLocalDays(d: Date, n: number, tz: string): Date {
  const z = new TZDate(d.getTime(), tz);
  const next = new TZDate(z.getFullYear(), z.getMonth(), z.getDate() + n, z.getHours(), z.getMinutes(), z.getSeconds(), z.getMilliseconds(), tz);
  return new Date(next.getTime());
}

export function localDateKey(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** One per lead / kind / local day. */
export function slotKeyFor(kind: NurtureContentKind, at: Date, tz: string): string {
  return `${kind}:${localDateKey(at, tz)}`;
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 3_600_000;
}
