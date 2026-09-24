import { addBusinessDays, addDays, differenceInCalendarDays, startOfDay } from "date-fns";

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

/** Whole calendar days a due date lies before the start of `today`. */
export function daysOverdue(dueAt: Date, today: Date = new Date()): number {
  return differenceInCalendarDays(startOfDay(today), startOfDay(dueAt));
}
