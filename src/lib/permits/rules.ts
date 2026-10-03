import type { PermitInspectionResult, PermitInspectionType, PermitStatus } from "@/generated/prisma/enums";

/**
 * One record for a permit fact.
 *
 * A permit's state used to be typed in several places: the status on the
 * permit, its dates beside it, an inspection result on the permit and again
 * on the workflow's inspection step. These rules decide what one entry
 * implies for the others, so the routes can write it once. Pure and
 * client-safe; the writers are in `service.ts` and `effects.ts`.
 */

export const PERMIT_STATUSES = ["APPLIED", "IN_PROGRESS", "ISSUED", "FINAL", "EXPIRED", "DENIED", "UNKNOWN"] as const satisfies readonly PermitStatus[];
export const INSPECTION_TYPES = ["ROUGH", "FRAMING", "ELECTRICAL", "PLUMBING", "MECHANICAL", "ROOFING_IN_PROGRESS", "ROOFING_FINAL", "FINAL", "OTHER"] as const satisfies readonly PermitInspectionType[];
export const INSPECTION_RESULTS = ["SCHEDULED", "PASS", "FAIL", "CONDITIONAL", "CANCELLED"] as const satisfies readonly PermitInspectionResult[];

export function isPermitStatus(v: unknown): v is PermitStatus {
  return typeof v === "string" && (PERMIT_STATUSES as readonly string[]).includes(v);
}
export function isInspectionType(v: unknown): v is PermitInspectionType {
  return typeof v === "string" && (INSPECTION_TYPES as readonly string[]).includes(v);
}
export function isInspectionResult(v: unknown): v is PermitInspectionResult {
  return typeof v === "string" && (INSPECTION_RESULTS as readonly string[]).includes(v);
}

/** A result the inspector gave, as opposed to "scheduled" or "cancelled". */
export type RecordedResult = Extract<PermitInspectionResult, "PASS" | "FAIL" | "CONDITIONAL">;
export function isRecordedResult(v: unknown): v is RecordedResult {
  return v === "PASS" || v === "FAIL" || v === "CONDITIONAL";
}

type PermitDates = { approvedDate: Date | null; finalPassedDate: Date | null };

/**
 * Dates a status change stamps. Only empty dates are filled — a date someone
 * typed is never overwritten — and a date sent in the same save wins.
 */
export function statusStamps(next: PermitStatus, current: PermitDates, today: Date): Partial<PermitDates> {
  const out: Partial<PermitDates> = {};
  // Not IN_PROGRESS: on the board that also holds a permit still in review.
  if ((next === "ISSUED" || next === "FINAL") && !current.approvedDate) out.approvedDate = today;
  if (next === "FINAL" && !current.finalPassedDate) out.finalPassedDate = today;
  return out;
}

/** Inspection types that are the permit's last: passing one closes the permit. */
export function isFinalType(type: PermitInspectionType): boolean {
  return type === "FINAL" || type === "ROOFING_FINAL";
}

/**
 * A passed final closes the permit when nothing else on it is still booked.
 * Permits that were never issued, or are already closed, are left alone.
 */
export function passClosesPermit(type: PermitInspectionType, permitStatus: PermitStatus, otherScheduledOnPermit: number): boolean {
  if (!isFinalType(type)) return false;
  if (permitStatus !== "ISSUED" && permitStatus !== "IN_PROGRESS") return false;
  return otherScheduledOnPermit === 0;
}

// ─── Permit inspection ↔ workflow inspection step ───────────────────────────

/** The part of a workflow key after the module, e.g. "roofing:dry_in_inspection" → "dry_in_inspection". */
function stepName(taskKey: string): string {
  return taskKey.slice(taskKey.lastIndexOf(":") + 1);
}

type StepKind = "final" | "in_progress" | "rough" | "insulation" | "other";

function stepKind(taskKey: string): StepKind {
  const name = stepName(taskKey);
  if (name.includes("final")) return "final";
  if (name.includes("rough")) return "rough";
  if (name.includes("insulation")) return "insulation";
  if (name.includes("dry_in") || name.includes("in_progress") || name.includes("deck")) return "in_progress";
  return "other";
}

const TYPE_KIND: Record<PermitInspectionType, StepKind> = {
  FINAL: "final",
  ROOFING_FINAL: "final",
  ROOFING_IN_PROGRESS: "in_progress",
  ROUGH: "rough",
  FRAMING: "rough",
  ELECTRICAL: "rough",
  PLUMBING: "rough",
  MECHANICAL: "rough",
  OTHER: "other",
};

export type StepCandidate = { id: string; workflowTaskKey: string; workflowSortOrder: number | null; status: string };

/**
 * The workflow inspection step a permit inspection belongs to: the first
 * active step of the same kind; an inspection of no particular kind takes the
 * only active inspection step when there is exactly one. Null when the job's
 * workflow has no matching step — the caller then acts without one.
 */
export function matchInspectionStep(type: PermitInspectionType, candidates: StepCandidate[]): StepCandidate | null {
  const sorted = [...candidates].sort((a, b) => (a.workflowSortOrder ?? 0) - (b.workflowSortOrder ?? 0));
  const kind = TYPE_KIND[type];
  if (kind !== "other") return sorted.find((c) => stepKind(c.workflowTaskKey) === kind) ?? null;
  return sorted.length === 1 ? sorted[0] : null;
}

/** A step that waits on more than one inspection ("Rough inspections", "Final inspection passed"): one pass does not finish it by itself. */
export function stepCoversSeveral(taskKey: string): boolean {
  const kind = stepKind(taskKey);
  return kind === "rough" || kind === "final";
}

/** Permit inspection types that belong to a workflow step; empty for a step of no particular kind. */
export function typesForStep(taskKey: string): PermitInspectionType[] {
  const kind = stepKind(taskKey);
  if (kind === "other" || kind === "insulation") return [];
  return INSPECTION_TYPES.filter((t) => TYPE_KIND[t] === kind);
}

/** The permit inspection type a workflow step's result is filed under. */
export function inspectionTypeForStep(taskKey: string): PermitInspectionType {
  const kind = stepKind(taskKey);
  if (kind === "final") return taskKey.startsWith("roofing:") ? "ROOFING_FINAL" : "FINAL";
  if (kind === "in_progress") return taskKey.startsWith("roofing:") ? "ROOFING_IN_PROGRESS" : "OTHER";
  if (kind === "rough") return "ROUGH";
  return "OTHER";
}

/**
 * Whether a permit inspection's result is also the step's result.
 *
 * A failure always is: any failed discipline stops the step. A pass is only
 * when it can be the whole step — "Rough inspections" covers several
 * disciplines and "Final inspection passed" covers every permit on the job,
 * so one pass does not finish them unless the person says so (`explicit`) or,
 * for the final, every permit on the job is now closed.
 */
export function resultAppliesToStep(input: {
  result: RecordedResult;
  step: StepCandidate;
  explicit: boolean;
  /** After this result: every permit on the job that is still live has passed its final. */
  allPermitsFinal: boolean;
}): boolean {
  const { result, step } = input;
  if (result === "FAIL") return true;
  // A step blocked by an earlier failure reopens through its correction task, not through a pass.
  if (step.status === "BLOCKED") return false;
  if (input.explicit) return true;
  const kind = stepKind(step.workflowTaskKey);
  if (kind === "rough") return false;
  if (kind === "final") return input.allPermitsFinal;
  return true;
}
