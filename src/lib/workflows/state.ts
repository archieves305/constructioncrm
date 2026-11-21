import type { PermitInspectionResult, Prisma, TaskStatus } from "@/generated/prisma/client";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";

/**
 * Workflow states are METADATA on the existing TaskStatus enum, never new
 * enum values — so every board, filter, email and report that switches on
 * status keeps working, and a workflow step is still just a task.
 *
 *   Not active        PENDING   + activatedAt null
 *   Ready             PENDING   + activatedAt set
 *   In progress       IN_PROGRESS
 *   Blocked           BLOCKED
 *   Failed inspection BLOCKED   + inspectionResult FAIL
 *   Done              COMPLETED
 *   Skipped           CANCELLED + skipReason
 *   Cancelled         CANCELLED (manual task)
 */
export type WorkflowTaskState =
  | "NOT_ACTIVE"
  | "READY"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "FAILED_INSPECTION"
  | "COMPLETED"
  | "SKIPPED"
  | "CANCELLED";

export type StateSource = {
  status: TaskStatus;
  activatedAt: Date | string | null;
  skipReason?: string | null;
  inspectionResult?: PermitInspectionResult | null;
};

export function deriveTaskState(t: StateSource): WorkflowTaskState {
  switch (t.status) {
    case "PENDING":
      return t.activatedAt ? "READY" : "NOT_ACTIVE";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "BLOCKED":
      return t.inspectionResult === "FAIL" ? "FAILED_INSPECTION" : "BLOCKED";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
      return t.skipReason ? "SKIPPED" : "CANCELLED";
  }
}

export const WORKFLOW_STATE_LABEL: Record<WorkflowTaskState, string> = {
  NOT_ACTIVE: "Not active",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  FAILED_INSPECTION: "Failed inspection",
  COMPLETED: "Done",
  SKIPPED: "Skipped",
  CANCELLED: "Cancelled",
};

/**
 * "Open and active" — the fragment every count and queue uses. A Not-active
 * workflow step is real but not yet anyone's work, so it stays out of
 * badges, digests, escalations and the default task list.
 */
export const ACTIVE_OPEN_WHERE = {
  status: { in: [...OPEN_TASK_STATUSES] },
  activatedAt: { not: null },
} satisfies Prisma.TaskWhereInput;

/** The mark inside a correction task's `workflowTaskKey` (`inspections.ts` CORRECTION_MARK). */
export const STEP_CORRECTION_MARK = ":correction:";

/** A template step: a workflow key that is not a correction. Never assigned (2026-11-21). */
export function isTemplateStepKey(key: string | null | undefined): boolean {
  return typeof key === "string" && !key.includes(STEP_CORRECTION_MARK);
}

/**
 * Not a workflow template step (a correction task is not one). Steps are a checklist on the job's Workflow tab and
 * belong to nobody (Richard, 2026-11-21: assigned steps buried people in
 * tasks they never did), so they stay out of every surface that means
 * "someone's work": task lists and badges, the calendar, digests, overdue
 * counts and escalations. A manual task added to a phase is still work.
 * Job-level workflow views (progress, health, the jobs list's workflow
 * filters) keep reading the steps.
 */
export const NOT_WORKFLOW_STEP_WHERE = {
  // A failed inspection's correction task carries a workflow key with this
  // mark; it is real work raised by an event and keeps its owner.
  NOT: { AND: [{ workflowTaskKey: { not: null } }, { NOT: { workflowTaskKey: { contains: STEP_CORRECTION_MARK } } }] },
} satisfies Prisma.TaskWhereInput;

/** Open, active and someone's work — `ACTIVE_OPEN_WHERE` without the workflow steps. */
export const TASK_WORK_WHERE = { ...ACTIVE_OPEN_WHERE, ...NOT_WORKFLOW_STEP_WHERE } satisfies Prisma.TaskWhereInput;
