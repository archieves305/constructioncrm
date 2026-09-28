import { addBusinessDays, addDays } from "date-fns";
import { dayKey, diffDayKeys } from "@/lib/time/zone";

/**
 * Due-date arithmetic for automation. Business days for office follow-ups
 * (a "follow up in 3 days" raised on Friday lands on Wednesday, not Monday
 * morning), plain days for the field, which works Saturdays.
 */

export function dueInBusinessDays(n: number, from: Date = new Date()): Date {
  const d = addBusinessDays(from, n);
  d.setHours(17, 0, 0, 0);
  return d;
}

export function dueTomorrow(from: Date = new Date()): Date {
  const d = addDays(from, 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Whole calendar days (in the office's zone) a due date lies before `today`. */
export function daysOverdue(dueAt: Date, today: Date = new Date()): number {
  return diffDayKeys(dayKey(dueAt), dayKey(today));
}
