/**
 * One table for every status the CRM shows: a plain label and a tone per enum
 * value. Pure data shared by the web (lib/ui/status.ts adds the check against
 * each Prisma enum) and the phone app (@crm/mobile-api), so a status reads the
 * same word in the same colour on both. An unknown value reads as words in a
 * neutral tone, never as a code.
 */
export type Tone = "neutral" | "info" | "warning" | "danger" | "success";
export type StatusEntry = { label: string; tone: Tone };

const e = (label: string, tone: Tone): StatusEntry => ({ label, tone });

const TASK = {
  PENDING: e("To do", "neutral"),
  IN_PROGRESS: e("In progress", "info"),
  BLOCKED: e("Blocked", "warning"),
  COMPLETED: e("Done", "success"),
  CANCELLED: e("Cancelled", "neutral"),
};

const PRIORITY = {
  LOW: e("Low", "neutral"),
  MEDIUM: e("Medium", "info"),
  HIGH: e("High", "warning"),
  URGENT: e("Urgent", "danger"),
};

const PERMIT = {
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

const INSPECTION_RESULT = {
  SCHEDULED: e("Scheduled", "info"),
  PASS: e("Passed", "success"),
  FAIL: e("Failed", "danger"),
  CONDITIONAL: e("Passed with conditions", "warning"),
  CANCELLED: e("Cancelled", "neutral"),
};

const INSPECTION_TYPE = {
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

const INVOICE = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent", "info"),
  PAID: e("Paid", "success"),
  VOID: e("Void", "neutral"),
};

const CHANGE_ORDER = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent to customer", "info"),
  APPROVED: e("Approved", "success"),
  REJECTED: e("Declined", "danger"),
  VOID: e("Void", "neutral"),
};

const EXPENSE = {
  PENDING: e("Waiting for approval", "warning"),
  APPROVED: e("Approved", "success"),
  REJECTED: e("Rejected", "danger"),
};

const EXPENSE_TYPE = {
  MATERIAL: e("Material", "neutral"),
  LABOR: e("Labor", "neutral"),
  EQUIPMENT: e("Equipment", "neutral"),
  PERMIT_FEE: e("Permit fee", "neutral"),
  SUBCONTRACTOR: e("Subcontractor", "neutral"),
  CHANGE_ORDER: e("Change order", "neutral"),
  OTHER: e("Other", "neutral"),
};

const ESTIMATE = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent", "info"),
  ACCEPTED: e("Accepted", "success"),
  DECLINED: e("Declined", "danger"),
};

const PAYMENT = {
  PENDING: e("Pending", "warning"),
  RECEIVED: e("Received", "success"),
  OVERDUE: e("Overdue", "danger"),
  WAIVED: e("Waived", "neutral"),
  REFUNDED: e("Refunded", "neutral"),
};

const PAYMENT_REQUEST = {
  REQUESTED: e("Requested", "warning"),
  PAID: e("Paid", "success"),
  CANCELLED: e("Withdrawn", "neutral"),
  CLOSED_UNPAID: e("Closed, not paid", "neutral"),
};

const COMMITMENT = {
  OPEN: e("Open", "info"),
  CLOSED: e("Closed", "neutral"),
  CANCELLED: e("Cancelled", "neutral"),
};

const DAILY_LOG = {
  DRAFT: e("Draft", "neutral"),
  SUBMITTED: e("Waiting for review", "warning"),
  APPROVED: e("Approved", "success"),
};

const CONTRACT = {
  DRAFT: e("Draft", "neutral"),
  SENT: e("Sent for signature", "info"),
  SIGNED: e("Signed", "success"),
  DECLINED: e("Declined", "danger"),
  VOID: e("Void", "neutral"),
};

const TEMPLATE_VERSION = {
  DRAFT: e("Draft", "warning"),
  PUBLISHED: e("Published", "success"),
  SUPERSEDED: e("Superseded", "neutral"),
  ARCHIVED: e("Archived", "neutral"),
};

const ROOFR_ORDER = {
  REQUESTED: e("Requested", "info"),
  COMPLETED: e("Report ready", "success"),
  CANCELLED: e("Cancelled", "neutral"),
  FAILED: e("Failed", "danger"),
};

const ROUTE = {
  PLANNED: e("Planned", "neutral"),
  IN_PROGRESS: e("In progress", "info"),
  COMPLETED: e("Completed", "success"),
  ARCHIVED: e("Archived", "neutral"),
};

const VIOLATION_ITEM = {
  OPEN: e("Open", "warning"),
  IN_PROGRESS: e("In progress", "info"),
  CORRECTED: e("Corrected", "success"),
  VERIFIED: e("Verified", "success"),
  WITHDRAWN: e("Withdrawn", "neutral"),
};

const HEARING = {
  SCHEDULED: e("Scheduled", "info"),
  CONTINUED: e("Continued", "warning"),
  HELD: e("Held", "success"),
  CANCELLED: e("Cancelled", "neutral"),
};

const AGENCY_INSPECTION = {
  REQUESTED: e("Requested", "warning"),
  SCHEDULED: e("Scheduled", "info"),
  COMPLETED: e("Completed", "success"),
  CANCELLED: e("Cancelled", "neutral"),
};

/** Agency inspection kinds are free text in the schema; these are the ones the app writes. */
const AGENCY_INSPECTION_KIND = {
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
