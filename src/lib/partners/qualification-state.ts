import type { QualificationStatus, RequirementStatus } from "@/generated/prisma/enums";
import type { DayKey } from "@/lib/time/zone";

/**
 * What a qualification and its checklist look like today, read from their
 * records. Pure and client-safe. Expiry and renewal are never stored states:
 * APPROVED plus a past `expiresAt` is EXPIRED; a requirement is "provided"
 * because a document is attached, "expired" because that document is.
 */

export type DerivedQualStatus = QualificationStatus | "EXPIRED" | "RENEWAL_DUE";

export const QUAL_STATUS_LABEL: Record<DerivedQualStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  INFO_REQUESTED: "Information requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  RENEWAL_DUE: "Renewal due",
};

/** A pinned day ("…T12:00Z") or any instant, as its UTC calendar day. */
export function docDay(d: Date | string): DayKey {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

export function daysUntil(d: Date | string | null | undefined, today: DayKey): number | null {
  if (!d) return null;
  return Math.round((Date.parse(`${docDay(d)}T12:00:00.000Z`) - Date.parse(`${today}T12:00:00.000Z`)) / 86_400_000);
}

export function deriveQualificationStatus(q: { status: QualificationStatus; expiresAt: Date | string | null; renewalDueAt: Date | string | null }, today: DayKey): DerivedQualStatus {
  if (q.status !== "APPROVED") return q.status;
  const left = daysUntil(q.expiresAt, today);
  if (left !== null && left < 0) return "EXPIRED";
  const renewal = daysUntil(q.renewalDueAt, today);
  if (renewal !== null && renewal <= 0) return "RENEWAL_DUE";
  return "APPROVED";
}

export type RequirementState = "missing" | "provided" | "expired" | "accepted" | "rejected" | "waived";

export const REQUIREMENT_STATE_LABEL: Record<RequirementState, string> = {
  missing: "Missing",
  provided: "Provided",
  expired: "Provided, expired",
  accepted: "Accepted",
  rejected: "Rejected",
  waived: "Waived",
};

export type RequirementLike = { status: RequirementStatus; required: boolean; companyDocumentId: string | null; companyDocument?: { expiresAt: Date | string | null } | null };

export function requirementState(r: RequirementLike, today: DayKey): RequirementState {
  if (r.status === "WAIVED") return "waived";
  if (r.status === "REJECTED") return "rejected";
  if (!r.companyDocumentId) return "missing";
  const left = daysUntil(r.companyDocument?.expiresAt ?? null, today);
  if (left !== null && left < 0) return "expired";
  return r.status === "ACCEPTED" ? "accepted" : "provided";
}

/** Satisfied = accepted, provided and in date, or waived. Optional lines are counted separately. */
export function coverage(reqs: readonly RequirementLike[], today: DayKey): { required: number; satisfied: number; missing: number; optionalSatisfied: number; optionalTotal: number } {
  let required = 0;
  let satisfied = 0;
  let missing = 0;
  let optionalSatisfied = 0;
  let optionalTotal = 0;
  for (const r of reqs) {
    const state = requirementState(r, today);
    const ok = state === "accepted" || state === "provided" || state === "waived";
    if (r.required) {
      required += 1;
      if (ok) satisfied += 1;
      else missing += 1;
    } else {
      optionalTotal += 1;
      if (ok) optionalSatisfied += 1;
    }
  }
  return { required, satisfied, missing, optionalSatisfied, optionalTotal };
}

/** The one qualification that speaks for an account: an approved one in date, else the most recently worked. */
export function pickRepresentative<Q extends { status: QualificationStatus; expiresAt: Date | string | null; renewalDueAt: Date | string | null; updatedAt: Date | string }>(quals: readonly Q[], today: DayKey): Q | null {
  if (quals.length === 0) return null;
  const live = quals.filter((q) => deriveQualificationStatus(q, today) === "APPROVED" || deriveQualificationStatus(q, today) === "RENEWAL_DUE");
  const pool = live.length ? live : quals;
  return [...pool].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null;
}
