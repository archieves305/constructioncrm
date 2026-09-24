import type { Priority, TaskStatus } from "@/generated/prisma/client";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/tasks/status";

/**
 * The one set of task colours for the UI.
 *
 * Three files each carried their own copy with slightly different shapes,
 * and they had already drifted (CANCELLED was amber in one, grey in another).
 * Semantics: grey = LOW / PENDING / CANCELLED, blue = MEDIUM / IN_PROGRESS,
 * amber = HIGH / BLOCKED, red = URGENT / overdue, green = COMPLETED.
 * Email keeps its own hex swatches in task-email.ts — inline styles only.
 */

export { STATUS_LABEL, TASK_STATUSES };
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const satisfies readonly Priority[];

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** Filled badge. */
export const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  PENDING: "bg-gray-100 text-gray-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-amber-100 text-amber-900",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-500",
};

/** Filled badge. */
export const PRIORITY_BADGE_CLASS: Record<Priority, string> = {
  LOW: "bg-gray-100 text-gray-700",
  MEDIUM: "bg-blue-50 text-blue-700",
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-red-100 text-red-700",
};

/** Outlined control (a select trigger, a chip). */
export const PRIORITY_OUTLINE_CLASS: Record<Priority, string> = {
  LOW: "border-gray-300 text-gray-700",
  MEDIUM: "border-blue-300 text-blue-700",
  HIGH: "border-amber-400 text-amber-800",
  URGENT: "border-red-500 text-red-700",
};

/** Selected chip in a segmented control. */
export const PRIORITY_SELECTED_CLASS: Record<Priority, string> = {
  LOW: "bg-gray-100 text-gray-800 ring-gray-300",
  MEDIUM: "bg-blue-50 text-blue-800 ring-blue-300",
  HIGH: "bg-amber-50 text-amber-900 ring-amber-300",
  URGENT: "bg-red-50 text-red-800 ring-red-300",
};

/** Small solid dot. */
export const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  LOW: "bg-gray-400",
  MEDIUM: "bg-blue-500",
  HIGH: "bg-amber-500",
  URGENT: "bg-red-500",
};

export const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  PENDING: "bg-gray-400",
  IN_PROGRESS: "bg-blue-500",
  BLOCKED: "bg-amber-500",
  COMPLETED: "bg-green-500",
  CANCELLED: "bg-gray-300",
};
