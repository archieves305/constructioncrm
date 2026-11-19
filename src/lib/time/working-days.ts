import { addDayKeys, diffDayKeys, weekdayOf, type DayKey } from "./zone";

/**
 * Working-day arithmetic on DayKeys. Monday to Friday. Holidays are skipped
 * only when a caller passes them (the PlanHub bid cadence reads
 * `business_holidays`); every older caller passes none and keeps counting as
 * before.
 */

export type Holidays = ReadonlySet<DayKey>;

export function isWorkingDay(day: DayKey, holidays?: Holidays): boolean {
  const w = weekdayOf(day);
  return w !== 0 && w !== 6 && !holidays?.has(day);
}

/** The nearest working day strictly before `day`. */
export function previousWorkingDay(day: DayKey, holidays?: Holidays): DayKey {
  let d = addDayKeys(day, -1);
  while (!isWorkingDay(d, holidays)) d = addDayKeys(d, -1);
  return d;
}

/** `n` working days after (or, negative, before) `day`; a weekend start counts from its next working day. */
export function addWorkingDays(day: DayKey, n: number, holidays?: Holidays): DayKey {
  let d = day;
  let left = Math.abs(n);
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d = addDayKeys(d, step);
    if (isWorkingDay(d, holidays)) left -= 1;
  }
  return d;
}

/** Working days from `a` (exclusive) to `b` (inclusive); 0 when `b` is not after `a`. */
export function workingDaysBetween(a: DayKey, b: DayKey, holidays?: Holidays): number {
  const span = diffDayKeys(a, b);
  if (span <= 0) return 0;
  let n = 0;
  for (let i = 1; i <= span; i += 1) if (isWorkingDay(addDayKeys(a, i), holidays)) n += 1;
  return n;
}

/** `day` itself when it is a working day, else the next one. */
export function onOrNextWorkingDay(day: DayKey, holidays?: Holidays): DayKey {
  let d = day;
  while (!isWorkingDay(d, holidays)) d = addDayKeys(d, 1);
  return d;
}
