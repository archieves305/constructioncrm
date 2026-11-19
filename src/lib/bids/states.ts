import { addressKey } from "@/lib/roofing/address";
import type { BidAwardKind, BidLossReason, BidPrimeStatus, BidProjectStage, BidScopeStatus } from "@/generated/prisma/enums";

/**
 * PlanHub bid projects: the three status axes, kept apart on purpose.
 *
 * - The project's stage (the job everyone is bidding).
 * - Each GC's prime status (did the GC win the job from the owner).
 * - KNU's subcontract status per scope, per GC (did we win our part).
 *
 * A GC losing the prime closes only that GC's opportunity. Silence never
 * closes anything: no rule here moves a status because time passed.
 * Pure and client-safe.
 */

export const PROJECT_STAGE_LABEL: Record<BidProjectStage, string> = {
  OPEN: "Open",
  PRIME_AWARDED: "Prime awarded",
  POSTPONED: "Postponed",
  REBIDDING: "Rebidding",
  CANCELLED: "Cancelled",
  CLOSED: "Closed",
};

export const PRIME_STATUS_LABEL: Record<BidPrimeStatus, string> = {
  UNKNOWN: "Not known",
  PENDING: "Owner deciding",
  GC_AWARDED: "GC won the job",
  GC_LOST: "GC lost the job",
  REBIDDING: "Rebidding",
  CANCELLED: "Cancelled",
};

export const SCOPE_STATUS_LABEL: Record<BidScopeStatus, string> = {
  PENDING: "Pending",
  VERBAL: "Verbal selection",
  AWARDED: "Awarded (in writing)",
  EXECUTED: "Subcontract signed",
  LOST: "Lost",
  WITHDRAWN: "Withdrawn",
  NO_BID: "Not bid",
  CANCELLED: "Cancelled",
};

export const AWARD_KIND_LABEL: Record<BidAwardKind, string> = { VERBAL: "Verbal selection", WRITTEN: "Written award", EXECUTED: "Signed subcontract" };

/** The project stages a person sets by hand; OPEN / PRIME_AWARDED / CLOSED follow the GCs. */
export const MANUAL_PROJECT_STAGES: readonly BidProjectStage[] = ["POSTPONED", "REBIDDING", "CANCELLED", "OPEN"];

export const PROJECT_STAGE_TRANSITIONS: Record<BidProjectStage, readonly BidProjectStage[]> = {
  OPEN: ["PRIME_AWARDED", "POSTPONED", "REBIDDING", "CANCELLED", "CLOSED"],
  PRIME_AWARDED: ["OPEN", "POSTPONED", "CANCELLED", "CLOSED"],
  POSTPONED: ["OPEN", "REBIDDING", "CANCELLED", "CLOSED"],
  REBIDDING: ["OPEN", "POSTPONED", "CANCELLED", "CLOSED"],
  CANCELLED: ["OPEN"],
  CLOSED: ["OPEN"],
};

export function canMoveProject(from: BidProjectStage, to: BidProjectStage): boolean {
  return from === to || PROJECT_STAGE_TRANSITIONS[from].includes(to);
}

/** A POSTPONED / REBIDDING / CANCELLED project needs a reason; POSTPONED and REBIDDING a review date too. */
export function projectStageNeeds(to: BidProjectStage): { reason: boolean; reviewAt: boolean } {
  return { reason: to === "POSTPONED" || to === "REBIDDING" || to === "CANCELLED", reviewAt: to === "POSTPONED" || to === "REBIDDING" };
}

export const PRIME_TRANSITIONS: Record<BidPrimeStatus, readonly BidPrimeStatus[]> = {
  UNKNOWN: ["PENDING", "GC_AWARDED", "GC_LOST", "REBIDDING", "CANCELLED"],
  PENDING: ["UNKNOWN", "GC_AWARDED", "GC_LOST", "REBIDDING", "CANCELLED"],
  GC_AWARDED: ["PENDING", "GC_LOST", "CANCELLED"],
  GC_LOST: ["PENDING", "GC_AWARDED", "REBIDDING"],
  REBIDDING: ["PENDING", "GC_AWARDED", "GC_LOST", "CANCELLED"],
  CANCELLED: ["PENDING", "REBIDDING"],
};

export function canMovePrime(from: BidPrimeStatus, to: BidPrimeStatus): boolean {
  return from === to || PRIME_TRANSITIONS[from].includes(to);
}

export const OPEN_SCOPE_STATUSES: readonly BidScopeStatus[] = ["PENDING", "VERBAL"];
export const WON_SCOPE_STATUSES: readonly BidScopeStatus[] = ["AWARDED", "EXECUTED"];
export const TERMINAL_SCOPE_STATUSES: readonly BidScopeStatus[] = ["AWARDED", "EXECUTED", "LOST", "WITHDRAWN", "NO_BID", "CANCELLED"];

export const SCOPE_TRANSITIONS: Record<BidScopeStatus, readonly BidScopeStatus[]> = {
  PENDING: ["VERBAL", "AWARDED", "EXECUTED", "LOST", "WITHDRAWN", "NO_BID", "CANCELLED"],
  VERBAL: ["PENDING", "AWARDED", "EXECUTED", "LOST", "WITHDRAWN", "CANCELLED"],
  AWARDED: ["EXECUTED", "CANCELLED"],
  EXECUTED: [],
  LOST: ["PENDING"],
  WITHDRAWN: ["PENDING"],
  NO_BID: ["PENDING"],
  CANCELLED: ["PENDING"],
};

export function canMoveScope(from: BidScopeStatus, to: BidScopeStatus): boolean {
  return from === to || SCOPE_TRANSITIONS[from].includes(to);
}

export const isOpenScope = (s: BidScopeStatus) => OPEN_SCOPE_STATUSES.includes(s);
export const isWonScope = (s: BidScopeStatus) => WON_SCOPE_STATUSES.includes(s);

/** The scope status an award of a kind writes. */
export function scopeStatusForAward(kind: BidAwardKind): BidScopeStatus {
  return kind === "VERBAL" ? "VERBAL" : kind === "WRITTEN" ? "AWARDED" : "EXECUTED";
}

/** Only a written award or a signed subcontract is "confirmed": it creates the job and counts as revenue. */
export function isConfirmedAward(kind: BidAwardKind): boolean {
  return kind !== "VERBAL";
}

/**
 * What a GC's opportunity becomes from its scopes: closed only when every
 * scope is decided. AWARDED if anything was won; otherwise the reason the
 * last scopes went (a GC that lost the prime reads LOST with GC_LOST_PRIME).
 */
export function opportunityOutcome(scopes: readonly { status: BidScopeStatus; lossReason?: BidLossReason | null }[]):
  | { closed: false }
  | { closed: true; outcome: "AWARDED" | "LOST" | "NO_BID" | "CANCELLED"; lossReason: BidLossReason | null } {
  if (scopes.length === 0 || scopes.some((s) => !TERMINAL_SCOPE_STATUSES.includes(s.status))) return { closed: false };
  if (scopes.some((s) => isWonScope(s.status))) return { closed: true, outcome: "AWARDED", lossReason: null };
  const lost = scopes.filter((s) => s.status === "LOST" || s.status === "WITHDRAWN");
  if (lost.length) {
    const reasons = new Set(lost.map((s) => (s.status === "WITHDRAWN" ? "WITHDRAWN" : (s.lossReason ?? "UNKNOWN"))));
    return { closed: true, outcome: "LOST", lossReason: reasons.size === 1 ? ([...reasons][0] as BidLossReason) : "OTHER" };
  }
  if (scopes.every((s) => s.status === "NO_BID")) return { closed: true, outcome: "NO_BID", lossReason: null };
  return { closed: true, outcome: "CANCELLED", lossReason: null };
}

/**
 * The project's own stage from its GCs, for the stages that follow them:
 * PRIME_AWARDED once any GC holds the job, CLOSED once every opportunity is
 * closed. A hand-set POSTPONED / REBIDDING / CANCELLED is left alone.
 */
export function derivedProjectStage(current: BidProjectStage, opps: readonly { closed: boolean; primeStatus: BidPrimeStatus }[]): BidProjectStage {
  if (current === "POSTPONED" || current === "REBIDDING" || current === "CANCELLED") return current;
  if (opps.length > 0 && opps.every((o) => o.closed)) return "CLOSED";
  if (opps.some((o) => o.primeStatus === "GC_AWARDED")) return "PRIME_AWARDED";
  return "OPEN";
}

/** BP-00001 */
export function bidProjectNumber(n: number): string {
  return `BP-${String(n).padStart(5, "0")}`;
}

/** The key two projects are the same by: the roofing library's address key (street words abbreviated) plus the zip. */
export function projectAddressKey(address1: string | null | undefined, zip: string | null | undefined): string | null {
  const street = (address1 ?? "").trim();
  if (!/^\d/.test(street)) return null;
  const z = (zip ?? "").replace(/\D/g, "").slice(0, 5);
  return z ? `${addressKey(street)}|${z}` : addressKey(street);
}

/** A project name compared loosely (case, punctuation, spacing). */
export function projectNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
