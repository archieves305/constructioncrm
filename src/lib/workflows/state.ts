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
