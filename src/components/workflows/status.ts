import { deriveTaskState, WORKFLOW_STATE_LABEL, type WorkflowTaskState } from "@/lib/workflows/state";
import type { Tone } from "@/lib/ui/tones";
import type { WorkflowPermitStatus } from "@/generated/prisma/client";

export { deriveTaskState, WORKFLOW_STATE_LABEL };
export type { WorkflowTaskState };

/** Filled-pill classes per workflow state. Literal strings so Tailwind sees them. */
export const WORKFLOW_STATE_PILL: Record<WorkflowTaskState, string> = {
  NOT_ACTIVE: "bg-gray-100 text-gray-500",
  READY: "bg-tone-info-soft text-tone-info-fg",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-tone-warning-soft text-tone-warning-fg",
  FAILED_INSPECTION: "bg-tone-danger-soft text-tone-danger-fg",
  COMPLETED: "bg-tone-success-soft text-tone-success-fg",
  SKIPPED: "bg-gray-100 text-gray-500 line-through decoration-gray-400",
  CANCELLED: "bg-gray-100 text-gray-500",
};

export const WORKFLOW_STATE_DOT: Record<WorkflowTaskState, string> = {
  NOT_ACTIVE: "bg-gray-300",
  READY: "bg-tone-info",
  IN_PROGRESS: "bg-blue-500",
  BLOCKED: "bg-tone-warning",
  FAILED_INSPECTION: "bg-tone-danger",
  COMPLETED: "bg-tone-success",
  SKIPPED: "bg-gray-300",
  CANCELLED: "bg-gray-300",
};

export const PERMIT_STATUS_LABEL: Record<WorkflowPermitStatus, string> = {
  UNDETERMINED: "Permit undetermined",
  REQUIRED: "Permit required",
  NOT_REQUIRED: "No permit required",
};

export const PERMIT_STATUS_TONE: Record<WorkflowPermitStatus, Tone> = {
  UNDETERMINED: "warning",
  REQUIRED: "info",
  NOT_REQUIRED: "neutral",
};

export function isOpenState(s: WorkflowTaskState): boolean {
  return s !== "COMPLETED" && s !== "SKIPPED" && s !== "CANCELLED";
}
