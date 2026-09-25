import type { CodeViolationStatus, WorkflowPermitStatus } from "@/generated/prisma/client";
import { daysRemaining } from "./dates";

/**
 * "Where is this case?" — derived, never stored. The lifecycle `status` is
 * the only stored answer; the 21 finer-grained labels the brief lists are
 * the workflow phase, the case's flags and its dates read together, so they
 * can never drift from the work.
 */

export type CaseFlag =
  | "overdue"
  | "due_soon"
  | "fines_accruing"
  | "lien_recorded"
  | "hearing_scheduled"
  | "inspection_scheduled"
  | "reinspection_requested"
  | "awaiting_agency"
  | "permit_undetermined"
  | "permit_pending"
  | "blocked_work"
  | "extension_pending"
  | "emergency"
  | "construction_required"
  | "corrective_work_complete";

export type CaseStateInput = {
  status: CodeViolationStatus;
  currentDeadline: Date | null;
  nextHearingAt: Date | null;
  nextInspectionAt: Date | null;
  reinspectionRequestedAt: Date | null;
  agencyConfirmedAt: Date | null;
  correctiveWorkCompletedAt: Date | null;
  extensionStatus: "REQUESTED" | "GRANTED" | "DENIED" | "WITHDRAWN" | null;
  emergency: boolean;
  constructionRequired: boolean;
  lienStatus: "NONE" | "RECORDED" | "RELEASED";
  finesAccruing: boolean;
  permitStatus: WorkflowPermitStatus | null;
  /** The linked job has a permit that is at least issued. */
  permitIssued: boolean;
  /** The workflow's current phase (lowest band with open work), when any. */
  phase: { key: string; name: string; band: number } | null;
  blockedSteps: number;
  dueSoonDays?: number;
};

export type CaseState = {
  status: CodeViolationStatus;
  phase: CaseStateInput["phase"];
  flags: CaseFlag[];
  overdue: boolean;
  deadlineInDays: number | null;
  /** One human label for lists and pills. */
  label: string;
};

export function deriveCaseState(c: CaseStateInput, now: Date): CaseState {
  const flags: CaseFlag[] = [];
  const open = c.status !== "CLOSED" && c.status !== "CANCELLED";
  const deadlineInDays = c.currentDeadline ? daysRemaining(c.currentDeadline, now) : null;
  const overdue = open && deadlineInDays !== null && deadlineInDays < 0 && !c.agencyConfirmedAt;
  if (overdue) flags.push("overdue");
  else if (open && deadlineInDays !== null && deadlineInDays <= (c.dueSoonDays ?? 7) && !c.agencyConfirmedAt) flags.push("due_soon");
  if (c.finesAccruing) flags.push("fines_accruing");
  if (c.lienStatus === "RECORDED") flags.push("lien_recorded");
  if (c.nextHearingAt && c.nextHearingAt >= now) flags.push("hearing_scheduled");
  if (c.nextInspectionAt && c.nextInspectionAt >= now) flags.push("inspection_scheduled");
  if (c.reinspectionRequestedAt && !c.agencyConfirmedAt) flags.push("reinspection_requested", "awaiting_agency");
  if (open && c.permitStatus === "UNDETERMINED") flags.push("permit_undetermined");
  if (open && c.permitStatus === "REQUIRED" && !c.permitIssued) flags.push("permit_pending");
  if (open && c.constructionRequired && !c.correctiveWorkCompletedAt && (c.permitStatus === "UNDETERMINED" || (c.permitStatus === "REQUIRED" && !c.permitIssued) || c.blockedSteps > 0)) flags.push("blocked_work");
  if (c.extensionStatus === "REQUESTED") flags.push("extension_pending");
  if (c.emergency) flags.push("emergency");
  if (c.constructionRequired) flags.push("construction_required");
  if (c.correctiveWorkCompletedAt) flags.push("corrective_work_complete");

  return { status: c.status, phase: c.phase, flags, overdue, deadlineInDays, label: labelFor(c, flags) };
}

const STATUS_LABEL: Record<CodeViolationStatus, string> = {
  NEW: "New",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  APPEALED: "Appealed",
  COMPLIED: "Complied",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export { STATUS_LABEL as CASE_STATUS_LABEL };

/** The brief's finer labels, from the phase + flags; falls back to the lifecycle status. */
function labelFor(c: CaseStateInput, flags: CaseFlag[]): string {
  if (c.status !== "ACTIVE") return STATUS_LABEL[c.status];
  if (flags.includes("hearing_scheduled")) return "Hearing scheduled";
  if (flags.includes("awaiting_agency")) return "Compliance pending verification";
  if (c.agencyConfirmedAt && (c.lienStatus === "RECORDED" || c.finesAccruing)) return "Fine / lien resolution pending";
  const key = c.phase?.key.split(":")[1] ?? "";
  switch (key) {
    case "intake":
      return "Under review";
    case "site_investigation":
      return "Site inspection needed";
    case "strategy":
      return "Approval pending";
    case "permit_required":
      return flags.includes("permit_pending") ? "Permit submitted" : "Permit required";
    case "no_permit":
      return "Permit not required";
    case "corrective_construction":
      return c.correctiveWorkCompletedAt ? "Work complete" : "Work in progress";
    case "agency_compliance":
      return flags.includes("reinspection_requested") ? "Reinspection requested" : "Awaiting reinspection";
    case "hearings_fines_liens":
      return "Fines and liens";
    case "closure":
      return "Closing";
    default:
      return flags.includes("permit_undetermined") ? "Permit undetermined" : STATUS_LABEL[c.status];
  }
}
