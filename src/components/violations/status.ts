import type { Tone } from "@/lib/ui/tones";
import type { CaseFlag } from "@/lib/violations/state";

/** Client-safe labels and tones (no Prisma imports). */

export const CASE_STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  APPEALED: "Appealed",
  COMPLIED: "Complied",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const CASE_STATUS_TONE: Record<string, Tone> = {
  NEW: "info",
  ACTIVE: "info",
  ON_HOLD: "neutral",
  APPEALED: "warning",
  COMPLIED: "success",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

export const ITEM_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  CORRECTED: "Corrected",
  VERIFIED: "Verified",
  WITHDRAWN: "Withdrawn",
};

export const ITEM_STATUS_TONE: Record<string, Tone> = {
  OPEN: "danger",
  IN_PROGRESS: "info",
  CORRECTED: "warning",
  VERIFIED: "success",
  WITHDRAWN: "neutral",
};

export const ITEM_STATUSES = ["OPEN", "IN_PROGRESS", "CORRECTED", "VERIFIED", "WITHDRAWN"] as const;

export const SEVERITY_LABEL: Record<string, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };
export const SEVERITY_TONE: Record<string, Tone> = { LOW: "neutral", MODERATE: "info", HIGH: "warning", CRITICAL: "danger" };

export const NOTICE_TYPE_LABEL: Record<string, string> = {
  NOTICE_OF_VIOLATION: "Notice of violation",
  CITATION: "Citation",
  STOP_WORK_ORDER: "Stop-work order",
  NOTICE_OF_HEARING: "Notice of hearing",
  LIEN_NOTICE: "Lien notice",
  OTHER: "Other",
};

export const HEARING_TYPE_LABEL: Record<string, string> = {
  SPECIAL_MAGISTRATE: "Special magistrate",
  CODE_ENFORCEMENT_BOARD: "Code enforcement board",
  APPEAL: "Appeal",
  LIEN_REDUCTION: "Lien reduction",
  OTHER: "Other",
};

export const HEARING_OUTCOME_LABEL: Record<string, string> = {
  COMPLIANCE_ORDERED: "Compliance ordered",
  FINE_IMPOSED: "Fine imposed",
  CONTINUED: "Continued",
  DISMISSED: "Dismissed",
  FOUND_IN_COMPLIANCE: "Found in compliance",
  LIEN_AUTHORIZED: "Lien authorized",
  MITIGATION_GRANTED: "Mitigation granted",
  MITIGATION_DENIED: "Mitigation denied",
  OTHER: "Other",
};

export const INSPECTION_RESULT_TONE: Record<string, Tone> = { PASS: "success", FAIL: "danger", CONDITIONAL: "warning", SCHEDULED: "info", CANCELLED: "neutral" };

export const FINE_ENTRY_LABEL: Record<string, string> = {
  OFFICIAL_BALANCE: "Official balance",
  ACCRUAL_STARTED: "Daily fine started",
  ACCRUAL_STOPPED: "Accrual stopped",
  FINE_IMPOSED: "Fine imposed",
  ADMIN_COST: "Administrative cost",
  PAYMENT: "Payment",
  MITIGATION_REQUESTED: "Mitigation requested",
  MITIGATION_DECIDED: "Mitigation decided",
  LIEN_RECORDED: "Lien recorded",
  LIEN_RELEASED: "Lien released",
  ADJUSTMENT: "Adjustment",
  NOTE: "Note",
};

export const FLAG_LABEL: Record<CaseFlag, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  fines_accruing: "Fines accruing",
  lien_recorded: "Lien recorded",
  hearing_scheduled: "Hearing scheduled",
  inspection_scheduled: "Inspection scheduled",
  reinspection_requested: "Reinspection requested",
  awaiting_agency: "Awaiting agency",
  permit_undetermined: "Permit undetermined",
  permit_pending: "Permit pending",
  blocked_work: "Work blocked",
  extension_pending: "Extension pending",
  emergency: "Emergency",
  construction_required: "Construction required",
  corrective_work_complete: "Work complete",
};

/** The flags worth an icon in a list row (the rest are already in the state label or deadline cell). */
export const ROW_FLAGS: CaseFlag[] = ["fines_accruing", "lien_recorded", "hearing_scheduled", "inspection_scheduled", "permit_undetermined", "permit_pending", "blocked_work", "awaiting_agency", "emergency"];

export const EVENT_LABEL: Record<string, string> = {
  NOTE: "Note",
  CREATED: "Case opened",
  STATUS_CHANGED: "Status changed",
  ASSIGNED: "Case manager",
  DEADLINE_CHANGED: "Deadline changed",
  EXTENSION_REQUESTED: "Extension requested",
  EXTENSION_DECIDED: "Extension decided",
  HEARING_SCHEDULED: "Hearing scheduled",
  HEARING_RESULT: "Hearing outcome",
  INSPECTION_REQUESTED: "Inspection requested",
  INSPECTION_RESULT: "Inspection result",
  ITEM_ADDED: "Item added",
  ITEM_STATUS_CHANGED: "Item status",
  FINE_ENTRY: "Fines",
  LIEN_RECORDED: "Lien recorded",
  LIEN_RELEASED: "Lien released",
  AGENCY_CONFIRMED: "Agency confirmed compliance",
  CORRECTIVE_WORK_COMPLETED: "Corrective work complete",
  JOB_LINKED: "Job linked",
  JOB_UNLINKED: "Job unlinked",
  WORKFLOW_APPLIED: "Workflow applied",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  FILE_ATTACHED: "File attached",
  COMMUNICATION_LOGGED: "Communication",
};
