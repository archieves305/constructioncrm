import type { Priority, TaskStatus } from "@/generated/prisma/client";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/tasks/status";
import type { StageTone } from "@/lib/ui/stage-colors";

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
  PENDING: "bg-surface-muted text-foreground",
  IN_PROGRESS: "bg-tone-info-soft text-tone-info-fg",
  BLOCKED: "bg-tone-warning-soft text-tone-warning-fg",
  COMPLETED: "bg-tone-success-soft text-tone-success-fg",
  CANCELLED: "bg-surface-muted text-muted-foreground",
};

/** Filled badge. */
export const PRIORITY_BADGE_CLASS: Record<Priority, string> = {
  LOW: "bg-surface-muted text-fg-secondary",
  MEDIUM: "bg-tone-info-soft text-tone-info-fg",
  HIGH: "bg-tone-warning-soft text-tone-warning-fg",
  URGENT: "bg-tone-danger-soft text-tone-danger-fg",
};

/** Outlined control (a select trigger, a chip). */
export const PRIORITY_OUTLINE_CLASS: Record<Priority, string> = {
  LOW: "border-border-strong text-fg-secondary",
  MEDIUM: "border-tone-info-line text-tone-info-fg",
  HIGH: "border-tone-warning text-tone-warning-fg",
  URGENT: "border-tone-danger text-tone-danger-fg",
};

/** Selected chip in a segmented control. */
export const PRIORITY_SELECTED_CLASS: Record<Priority, string> = {
  LOW: "bg-surface-muted text-foreground ring-border-strong",
  MEDIUM: "bg-tone-info-soft text-tone-info-fg ring-tone-info-line",
  HIGH: "bg-tone-warning-soft text-tone-warning-fg ring-tone-warning-line",
  URGENT: "bg-tone-danger-soft text-tone-danger-fg ring-tone-danger-line",
};

/** Small solid dot. */
export const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  LOW: "bg-tone-neutral",
  MEDIUM: "bg-tone-info",
  HIGH: "bg-tone-warning",
  URGENT: "bg-tone-danger",
};

/** Board column tones, in the same shape the stage helper returns. */
const tone = (bar: string, pill: string, text: string, ring: string, solid: string): StageTone => ({
  key: "neutral",
  bar,
  dot: bar,
  pill,
  text,
  ring,
  solid,
});
export const STATUS_TONE: Record<TaskStatus, StageTone> = {
  PENDING: tone("bg-tone-neutral", "bg-tone-neutral-soft text-tone-neutral-fg", "text-tone-neutral-fg", "ring-tone-neutral/40", "bg-tone-neutral text-white"),
  IN_PROGRESS: tone("bg-tone-info", "bg-tone-info-soft text-tone-info-fg", "text-tone-info-fg", "ring-tone-info/40", "bg-tone-info text-white"),
  BLOCKED: tone("bg-tone-warning", "bg-tone-warning-soft text-tone-warning-fg", "text-tone-warning-fg", "ring-tone-warning/40", "bg-tone-warning text-white"),
  COMPLETED: tone("bg-tone-success", "bg-tone-success-soft text-tone-success-fg", "text-tone-success-fg", "ring-tone-success/40", "bg-tone-success text-white"),
  CANCELLED: tone("bg-surface-emphasis", "bg-surface-muted text-muted-foreground", "text-muted-foreground", "ring-border-strong", "bg-tone-neutral text-white"),
};

export const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  PENDING: "bg-tone-neutral",
  IN_PROGRESS: "bg-tone-info",
  BLOCKED: "bg-tone-warning",
  COMPLETED: "bg-tone-success",
  CANCELLED: "bg-surface-emphasis",
};
