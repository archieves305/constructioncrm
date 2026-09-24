import type { TaskStatus } from "@/generated/prisma/client";

/**
 * Which statuses count as "still open".
 *
 * BLOCKED is open: a stalled task is exactly the one that should stay in
 * front of people. Three call sites (the dashboard KPI, the jobs-list chip
 * and the leads-list chip) had drifted to PENDING/IN_PROGRESS only, so a
 * blocked-and-overdue task vanished from every summary. One constant, used
 * everywhere, is the fix.
 */
export const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED"] as const satisfies readonly TaskStatus[];

export const TASK_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly TaskStatus[];

export function isOpenStatus(status: TaskStatus): boolean {
  return (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Done",
  CANCELLED: "Cancelled",
};
