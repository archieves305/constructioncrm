/**
 * One table for every status the app shows: a plain label and a tone per enum
 * value. <StatusBadge kind="permit" value={p.status} /> reads it, so no screen
 * prints a raw code ("BUILDING", "CLOSED_UNPAID") and no two screens colour
 * the same status differently. Client-safe. Each table is typed against its
 * Prisma enum, so a new enum value without a label fails the typecheck (and
 * status.test.ts checks the same at runtime).
 */
import type {
  ChangeOrderStatus,
  CodeViolationHearingStatus,
  CodeViolationInspectionStatus,
  CodeViolationItemStatus,
  CommitmentStatus,
  ContractTemplateVersionStatus,
  CustomerContractStatus,
  DailyLogStatus,
  DoorKnockRouteStatus,
  EstimateStatus,
  ExpenseStatus,
  InvoiceStatus,
  JobExpenseType,
  LaborPaymentRequestStatus,
  PaymentStatus,
  PermitInspectionResult,
  PermitInspectionType,
  PermitStatus,
  Priority,
  RoofrOrderStatus,
  TaskStatus,
  WorkflowVersionStatus,
} from "@/generated/prisma/enums";
import type { Tone } from "./tones";

export type StatusEntry = { label: string; tone: Tone };
type Table<E extends string> = Record<E, StatusEntry>;

const e = (label: string, tone: Tone): StatusEntry => ({ label, tone });

const TASK: Table<TaskStatus> = {
  PENDING: e("To do", "neutral"),
  IN_PROGRESS: e("In progress", "info"),
  BLOCKED: e("Blocked", "warning"),
  COMPLETED: e("Done", "success"),
  CANCELLED: e("Cancelled", "neutral"),
};

const PRIORITY: Table<Priority> = {
  LOW: e("Low", "neutral"),
  MEDIUM: e("Medium", "info"),
  HIGH: e("High", "warning"),
  URGENT: e("Urgent", "danger"),
};

const PERMIT: Table<PermitStatus> = {
  PREPARING: e("Preparing", "neutral"),
  APPLIED: e("Applied", "info"),
  CORRECTIONS: e("Corrections", "warning"),
  IN_PROGRESS: e("In progress", "info"),
  ISSUED: e("Issued", "success"),
  FINAL: e("Final", "success"),
  EXPIRED: e("Expired", "danger"),
  DENIED: e("Denied", "danger"),
  UNKNOWN: e("Unknown", "neutral"),
};

const INSPECTION_RESULT: Table<PermitInspectionResult> = {
  SCHEDULED: e("Scheduled", "info"),
  PASS: e("Passed", "success"),
  FAIL: e("Failed", "danger"),
  CONDITIONAL: e("Passed with conditions", "warning"),
  CANCELLED: e("Cancelled", "neutral"),
};

const INSPECTION_TYPE: Table<PermitInspectionType> = {
  ROUGH: e("Rough", "neutral"),
  FRAMING: e("Framing", "neutral"),
  ELECTRICAL: e("Electrical", "neutral"),
  PLUMBING: e("Plumbing", "neutral"),
  MECHANICAL: e("Mechanical", "neutral"),
  ROOFING_IN_PROGRESS: e("Roofing in-progress", "neutral"),
  ROOFING_FINAL: e("Roofing final", "neutral"),
  FINAL: e("Final", "neutral"),
  OTHER: e("Other", "neutral"),
};

const INVOICE: Table<InvoiceStatus> = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent", "info"),
  PAID: e("Paid", "success"),
  VOID: e("Void", "neutral"),
};

const CHANGE_ORDER: Table<ChangeOrderStatus> = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent to customer", "info"),
  APPROVED: e("Approved", "success"),
  REJECTED: e("Declined", "danger"),
  VOID: e("Void", "neutral"),
};

const EXPENSE: Table<ExpenseStatus> = {
  PENDING: e("Waiting for approval", "warning"),
  APPROVED: e("Approved", "success"),
  REJECTED: e("Rejected", "danger"),
};

const EXPENSE_TYPE: Table<JobExpenseType> = {
  MATERIAL: e("Material", "neutral"),
  LABOR: e("Labor", "neutral"),
  EQUIPMENT: e("Equipment", "neutral"),
  PERMIT_FEE: e("Permit fee", "neutral"),
  SUBCONTRACTOR: e("Subcontractor", "neutral"),
  CHANGE_ORDER: e("Change order", "neutral"),
  OTHER: e("Other", "neutral"),
};

const ESTIMATE: Table<EstimateStatus> = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent", "info"),
  ACCEPTED: e("Accepted", "success"),
  DECLINED: e("Declined", "danger"),
};

const PAYMENT: Table<PaymentStatus> = {
  PENDING: e("Pending", "warning"),
  RECEIVED: e("Received", "success"),
  OVERDUE: e("Overdue", "danger"),
  WAIVED: e("Waived", "neutral"),
  REFUNDED: e("Refunded", "neutral"),
};

const PAYMENT_REQUEST: Table<LaborPaymentRequestStatus> = {
  REQUESTED: e("Requested", "warning"),
  PAID: e("Paid", "success"),
  CANCELLED: e("Withdrawn", "neutral"),
  CLOSED_UNPAID: e("Closed, not paid", "neutral"),
};

const COMMITMENT: Table<CommitmentStatus> = {
  OPEN: e("Open", "info"),
  CLOSED: e("Closed", "neutral"),
  CANCELLED: e("Cancelled", "neutral"),
};

const DAILY_LOG: Table<DailyLogStatus> = {
  DRAFT: e("Draft", "neutral"),
  SUBMITTED: e("Waiting for review", "warning"),
  APPROVED: e("Approved", "success"),
};

const CONTRACT: Table<CustomerContractStatus> = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent for signature", "info"),
  SIGNED: e("Signed", "success"),
  DECLINED: e("Declined", "danger"),
  VOID: e("Void", "neutral"),
};

const TEMPLATE_VERSION: Table<ContractTemplateVersionStatus & WorkflowVersionStatus> = {
  DRAFT: e("Draft", "warning"),
  PUBLISHED: e("Published", "success"),
  SUPERSEDED: e("Superseded", "neutral"),
  ARCHIVED: e("Archived", "neutral"),
};

const ROOFR_ORDER: Table<RoofrOrderStatus> = {
  REQUESTED: e("Requested", "info"),
  COMPLETED: e("Report ready", "success"),
  CANCELLED: e("Cancelled", "neutral"),
  FAILED: e("Failed", "danger"),
};

const ROUTE: Table<DoorKnockRouteStatus> = {
  PLANNED: e("Planned", "neutral"),
  IN_PROGRESS: e("In progress", "info"),
  COMPLETED: e("Completed", "success"),
  ARCHIVED: e("Archived", "neutral"),
};

const VIOLATION_ITEM: Table<CodeViolationItemStatus> = {
  OPEN: e("Open", "warning"),
  IN_PROGRESS: e("In progress", "info"),
  CORRECTED: e("Corrected", "success"),
  VERIFIED: e("Verified", "success"),
  WITHDRAWN: e("Withdrawn", "neutral"),
};

const HEARING: Table<CodeViolationHearingStatus> = {
  SCHEDULED: e("Scheduled", "info"),
  CONTINUED: e("Continued", "warning"),
  HELD: e("Held", "success"),
  CANCELLED: e("Cancelled", "neutral"),
};

const AGENCY_INSPECTION: Table<CodeViolationInspectionStatus> = {
  REQUESTED: e("Requested", "warning"),
  SCHEDULED: e("Scheduled", "info"),
  COMPLETED: e("Completed", "success"),
  CANCELLED: e("Cancelled", "neutral"),
};

/** Agency inspection kinds are free text in the schema; these are the ones the app writes. */
const AGENCY_INSPECTION_KIND: Record<string, StatusEntry> = {
  INITIAL: e("Initial", "neutral"),
  REINSPECTION: e("Re-inspection", "neutral"),
  FINAL: e("Final", "neutral"),
};

export const STATUS = {
  task: TASK,
  priority: PRIORITY,
  permit: PERMIT,
  inspectionResult: INSPECTION_RESULT,
  inspectionType: INSPECTION_TYPE,
  invoice: INVOICE,
  changeOrder: CHANGE_ORDER,
  expense: EXPENSE,
  expenseType: EXPENSE_TYPE,
  estimate: ESTIMATE,
  payment: PAYMENT,
  paymentRequest: PAYMENT_REQUEST,
  commitment: COMMITMENT,
  dailyLog: DAILY_LOG,
  contract: CONTRACT,
  templateVersion: TEMPLATE_VERSION,
  roofrOrder: ROOFR_ORDER,
  route: ROUTE,
  violationItem: VIOLATION_ITEM,
  hearing: HEARING,
  agencyInspection: AGENCY_INSPECTION,
  agencyInspectionKind: AGENCY_INSPECTION_KIND,
} as const;

export type StatusKind = keyof typeof STATUS;

/**
 * The label and tone for a value; an unknown value (old data, a new enum value
 * not deployed here yet) reads as words in a neutral tone, never as a code.
 */
export function statusOf(kind: StatusKind, value: string | null | undefined): StatusEntry | null {
  if (!value) return null;
  const table = STATUS[kind] as Record<string, StatusEntry>;
  return table[value] ?? { label: humanize(value), tone: "neutral" };
}

export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  return statusOf(kind, value)?.label ?? "—";
}

/** `{ VALUE: "Label" }` for a Base UI Select's `items`. */
export function statusItems(kind: StatusKind): Record<string, string> {
  return Object.fromEntries(Object.entries(STATUS[kind] as Record<string, StatusEntry>).map(([k, v]) => [k, v.label]));
}

/** `{ VALUE: tone }` for code that colours by status without the badge. */
export function statusTones(kind: StatusKind): Record<string, Tone> {
  return Object.fromEntries(Object.entries(STATUS[kind] as Record<string, StatusEntry>).map(([k, v]) => [k, v.tone]));
}

function humanize(code: string): string {
  const s = code.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
