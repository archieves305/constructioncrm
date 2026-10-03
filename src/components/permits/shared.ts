import { format } from "date-fns";
import type { Tone } from "@/lib/ui/tones";

/** Client-side shapes and wording for permits and their inspections. */

export type InspectionStep = { id: string; title: string; status: string; workflowTaskKey: string; workflowSortOrder: number | null };

export type PermitInspection = {
  id: string;
  permitId: string;
  type: string;
  scheduledFor: string | null;
  completedAt: string | null;
  result: string;
  inspectorName: string | null;
  notes: string | null;
  taskId: string | null;
  task?: { id: string; title: string; status: string } | null;
};

export type PermitRecord = {
  id: string;
  jobId: string;
  municipality: string;
  permitType: string | null;
  permitNumber: string | null;
  status: string;
  submittedDate: string | null;
  expectedApprovalDate: string | null;
  approvedDate: string | null;
  expirationDate: string | null;
  finalPassedDate: string | null;
  permitFee: string | null;
  inspectorName: string | null;
  notes: string | null;
  assignedUserId: string | null;
  assignedTo?: { id?: string; firstName: string; lastName: string } | null;
  inspections?: PermitInspection[];
};

/** A permit-fee charge on the job's costs (from the bank feed or entered under Money). */
export type PermitFeeCharge = { id: string; vendor: string | null; description: string | null; amount: string; incurredDate: string };

export type JobPermitsData = { permits: PermitRecord[]; steps: InspectionStep[]; feeCharges?: PermitFeeCharge[]; canEdit: boolean };

export type AssignableUser = { id: string; firstName: string; lastName: string };

export const jobPermitsKey = (jobId: string) => ["job", jobId, "permits"] as const;

export const PERMIT_STATUS_OPTIONS = ["APPLIED", "IN_PROGRESS", "ISSUED", "FINAL", "EXPIRED", "DENIED"] as const;

export const PERMIT_STATUS_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  IN_PROGRESS: "In progress",
  ISSUED: "Issued",
  FINAL: "Final",
  EXPIRED: "Expired",
  DENIED: "Denied",
  UNKNOWN: "Unknown",
};

export const PERMIT_STATUS_TONE: Record<string, Tone> = {
  APPLIED: "info",
  IN_PROGRESS: "info",
  ISSUED: "success",
  FINAL: "success",
  EXPIRED: "danger",
  DENIED: "danger",
  UNKNOWN: "neutral",
};

export const RESULT_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  PASS: "Passed",
  FAIL: "Failed",
  CONDITIONAL: "Passed with conditions",
  CANCELLED: "Cancelled",
};

export const RESULT_TONE: Record<string, Tone> = {
  SCHEDULED: "info",
  PASS: "success",
  FAIL: "danger",
  CONDITIONAL: "warning",
  CANCELLED: "neutral",
};

export const INSPECTION_TYPE_LABEL: Record<string, string> = {
  ROUGH: "Rough",
  FRAMING: "Framing",
  ELECTRICAL: "Electrical",
  PLUMBING: "Plumbing",
  MECHANICAL: "Mechanical",
  ROOFING_IN_PROGRESS: "Roofing in-progress",
  ROOFING_FINAL: "Roofing final",
  FINAL: "Final",
  OTHER: "Other",
};

export const typeLabel = (t: string) => INSPECTION_TYPE_LABEL[t] ?? t;

/**
 * A date picker saves a day as midnight UTC, which is the evening before in
 * the office's zone — so a "pinned" day is read from its UTC parts, and only
 * a value with a real time is shown in local time.
 */
function isPinnedDay(d: Date): boolean {
  return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && (d.getUTCHours() === 0 || d.getUTCHours() === 12);
}

/** The day as `yyyy-MM-dd` for a date input. */
export function dayOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isPinnedDay(d) ? iso.slice(0, 10) : format(d, "yyyy-MM-dd");
}

/** The time as `HH:mm` for a time input; empty for an all-day value. */
export function timeOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isPinnedDay(d) ? "" : format(d, "HH:mm");
}

/** A day, and a time when there is one, as the value the API stores. */
export function joinWhen(day: string, time: string): string | null {
  if (!day) return null;
  return time ? new Date(`${day}T${time}`).toISOString() : day;
}

export function formatDay(iso: string | null | undefined): string {
  const day = dayOf(iso);
  return day ? format(new Date(`${day}T12:00:00`), "MMM d, yyyy") : "—";
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "No date yet";
  const time = timeOf(iso);
  return time ? `${formatDay(iso)}, ${format(new Date(iso), "h:mm a")}` : formatDay(iso);
}

/** Whole days from today to a stored day; negative once it has passed. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  const day = dayOf(iso);
  if (!day) return null;
  const today = format(now, "yyyy-MM-dd");
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

/** Days before expiry at which a permit in force is called out. */
export const EXPIRY_WARNING_DAYS = 30;

/** A permit still in force whose expiry is near or past. */
export function expiryNotice(p: Pick<PermitRecord, "status" | "expirationDate">): { tone: Tone; text: string } | null {
  if (p.status === "FINAL" || p.status === "DENIED") return null;
  const d = daysUntil(p.expirationDate);
  if (d === null) return p.status === "EXPIRED" ? { tone: "danger", text: "Expired" } : null;
  if (d < 0 || p.status === "EXPIRED") return { tone: "danger", text: d < 0 ? `Expired ${-d} day${d === -1 ? "" : "s"} ago` : "Expired" };
  if (d <= EXPIRY_WARNING_DAYS) return { tone: "warning", text: d === 0 ? "Expires today" : `Expires in ${d} day${d === 1 ? "" : "s"}` };
  return null;
}
