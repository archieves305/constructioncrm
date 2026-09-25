/**
 * Calendar-day helpers for deadlines. Deadlines are dates a code officer
 * wrote on a notice, so they count in calendar days — unlike task due
 * offsets, which are business days.
 */

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Whole calendar days from `now` to `at`; negative when overdue; 0 = today. */
export function daysRemaining(at: Date, now: Date): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / DAY);
}

export type DeadlineState = "overdue" | "today" | "d1" | "d3" | "d7" | "d14" | "d30" | "later";

/** The reminder bucket a date sits in, using the brief's 30/14/7/3/1/today thresholds. */
export function deadlineState(at: Date, now: Date): DeadlineState {
  const n = daysRemaining(at, now);
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n <= 1) return "d1";
  if (n <= 3) return "d3";
  if (n <= 7) return "d7";
  if (n <= 14) return "d14";
  if (n <= 30) return "d30";
  return "later";
}

/** "3 days overdue" / "due today" / "in 12 days". */
export function describeDaysRemaining(at: Date, now: Date): string {
  const n = daysRemaining(at, now);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "due today";
  return `in ${n} day${n === 1 ? "" : "s"}`;
}

export type DateBucket = "overdue" | "today" | "week" | "later" | "none";

export function bucketOf(at: Date | null, now: Date): DateBucket {
  if (!at) return "none";
  const n = daysRemaining(at, now);
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n <= 7) return "week";
  return "later";
}
