import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import { APP_TIME_ZONE, dayKey, endOfDayIn, startOfDayIn } from "@/lib/time/zone";

/**
 * "Is it late?" — one answer for the calendar, the lists and the counts.
 *
 * An all-day task is late once its day is over in the office's zone, not at
 * 8:01 that morning (which is what `dueAt < now` said about a noon-UTC pin).
 * A timed task is late the moment its window ends.
 */

export type CalendarStatus = "not_started" | "in_progress" | "blocked" | "completed" | "cancelled" | "overdue";

type Dated = { dueAt: Date | string | null; allDay?: boolean | null; status: TaskStatus };

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

export function isOverdue(t: Dated, now: Date = new Date(), tz: string = APP_TIME_ZONE): boolean {
  if (!t.dueAt) return false;
  if (t.status === "COMPLETED" || t.status === "CANCELLED") return false;
  const due = asDate(t.dueAt);
  if (t.allDay ?? true) return now > endOfDayIn(dayKey(due, tz), tz);
  return now > due;
}

/** Precedence: closed states, then late, then the working states. */
export function deriveCalendarStatus(t: Dated, now: Date = new Date(), tz: string = APP_TIME_ZONE): CalendarStatus {
  if (t.status === "CANCELLED") return "cancelled";
  if (t.status === "COMPLETED") return "completed";
  if (isOverdue(t, now, tz)) return "overdue";
  if (t.status === "BLOCKED") return "blocked";
  if (t.status === "IN_PROGRESS") return "in_progress";
  return "not_started";
}

/**
 * The same rule as a Prisma clause, for `?overdue=1`, the field tiles and the
 * dashboard KPI. Callers add their own status / activation filters.
 */
export function overdueWhere(now: Date = new Date(), tz: string = APP_TIME_ZONE): Prisma.TaskWhereInput {
  return {
    OR: [
      { allDay: true, dueAt: { lt: startOfDayIn(dayKey(now, tz), tz) } },
      { allDay: false, dueAt: { lt: now } },
    ],
  };
}

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Done",
  cancelled: "Cancelled",
  overdue: "Overdue",
};
