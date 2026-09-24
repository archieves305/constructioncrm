import { isPast, isToday } from "date-fns";
import type { TaskStatus } from "@/generated/prisma/client";
import { isOpenStatus } from "./status";

/**
 * Pure counting and bucketing over a user's tasks.
 *
 * Kept free of Prisma so the sidebar badge, the dashboard widget, the field
 * index and the tasks page all bucket identically — and so "is this overdue
 * or due today?" is one tested function rather than five copies of a date
 * comparison. Uses the same `isPast && !isToday` rule the tasks page always
 * has, so the numbers agree with what people see there.
 */

export type DueBucket = "overdue" | "today" | "upcoming" | "noDate";

export type TaskSummary = {
  open: number;
  overdue: number;
  dueToday: number;
  blocked: number;
};

type Dated = { dueAt: Date | string | null; status: TaskStatus };

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

export function dueBucket(dueAt: Date | string | null): DueBucket {
  if (!dueAt) return "noDate";
  const d = asDate(dueAt);
  if (isToday(d)) return "today";
  if (isPast(d)) return "overdue";
  return "upcoming";
}

export function summarizeTasks(rows: Dated[]): TaskSummary {
  const out: TaskSummary = { open: 0, overdue: 0, dueToday: 0, blocked: 0 };
  for (const t of rows) {
    if (!isOpenStatus(t.status)) continue;
    out.open++;
    if (t.status === "BLOCKED") out.blocked++;
    const b = dueBucket(t.dueAt);
    if (b === "overdue") out.overdue++;
    else if (b === "today") out.dueToday++;
  }
  return out;
}

export function bucketByDue<T extends Dated>(rows: T[]): Record<DueBucket, T[]> {
  const out: Record<DueBucket, T[]> = { overdue: [], today: [], upcoming: [], noDate: [] };
  for (const t of rows) {
    if (!isOpenStatus(t.status)) continue;
    out[dueBucket(t.dueAt)].push(t);
  }
  return out;
}
