import { addDayKeys, diffDayKeys, weekdayOf, type DayKey } from "./zone";

/**
 * Working-day arithmetic on DayKeys. Monday to Friday; holidays are
 * deliberately ignored, as the crew install planner always has — a holiday
 * off by one day in a follow-up threshold is not worth a calendar table.
 */

export function isWorkingDay(day: DayKey): boolean {
  const w = weekdayOf(day);
  return w !== 0 && w !== 6;
}

/** The nearest working day strictly before `day`. */
export function previousWorkingDay(day: DayKey): DayKey {
  let d = addDayKeys(day, -1);
  while (!isWorkingDay(d)) d = addDayKeys(d, -1);
  return d;
}

/** `n` working days after (or, negative, before) `day`; a weekend start counts from its next working day. */
export function addWorkingDays(day: DayKey, n: number): DayKey {
  let d = day;
  let left = Math.abs(n);
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d = addDayKeys(d, step);
    if (isWorkingDay(d)) left -= 1;
  }
  return d;
}

/** Working days from `a` (exclusive) to `b` (inclusive); 0 when `b` is not after `a`. */
export function workingDaysBetween(a: DayKey, b: DayKey): number {
  const span = diffDayKeys(a, b);
  if (span <= 0) return 0;
  let n = 0;
  for (let i = 1; i <= span; i += 1) if (isWorkingDay(addDayKeys(a, i))) n += 1;
  return n;
}
