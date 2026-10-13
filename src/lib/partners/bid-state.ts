import type { BidOutcome, BidPlatform, BidStatus } from "@/generated/prisma/enums";

/**
 * The bid pipeline, as a transition table. Status is the master: the lead's
 * stage mirrors only Won and Lost. WAITING_* and REVISION are not states —
 * a note (`waitingOn`) or a new submission version — so the board columns
 * stay the seven below.
 */
export const BID_STATUSES: readonly BidStatus[] = ["TRACKING", "INVITED", "DECIDING", "ESTIMATING", "SUBMITTED", "SHORTLISTED", "CLOSED"];

export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  TRACKING: "Tracking",
  INVITED: "Invited",
  DECIDING: "Deciding",
  ESTIMATING: "Estimating",
  SUBMITTED: "Submitted",
  SHORTLISTED: "Shortlisted",
  CLOSED: "Closed",
};

export const BID_STATUS_HINT: Record<BidStatus, string> = {
  TRACKING: "A project we heard about; no invitation yet",
  INVITED: "The GC asked us to bid",
  DECIDING: "Bid / no-bid under review",
  ESTIMATING: "Takeoff and pricing under way",
  SUBMITTED: "Our price is with the GC",
  SHORTLISTED: "Down to the last few",
  CLOSED: "Decided: awarded, lost, passed, cancelled",
};

export const BID_TRANSITIONS: Record<BidStatus, readonly BidStatus[]> = {
  TRACKING: ["INVITED", "DECIDING", "CLOSED"],
  INVITED: ["DECIDING", "ESTIMATING", "CLOSED"],
  DECIDING: ["ESTIMATING", "INVITED", "CLOSED"],
  ESTIMATING: ["SUBMITTED", "DECIDING", "CLOSED"],
  SUBMITTED: ["SHORTLISTED", "ESTIMATING", "CLOSED"],
  SHORTLISTED: ["SUBMITTED", "CLOSED"],
  CLOSED: ["INVITED"],
};

export function canTransition(from: BidStatus, to: BidStatus): boolean {
  return from === to || BID_TRANSITIONS[from].includes(to);
}

export const BID_PLATFORM_LABEL: Record<BidPlatform, string> = { BUILDINGCONNECTED: "BuildingConnected", PROCORE: "Procore", PLANHUB: "PlanHub", SMARTBID: "SmartBid", CONSTRUCTCONNECT: "ConstructConnect", TEXTURA: "Textura", EMAIL: "Email", OTHER: "Other" };

/** Open = still in play; a closed bid has an outcome. */
export const OPEN_BID_STATUSES: readonly BidStatus[] = ["TRACKING", "INVITED", "DECIDING", "ESTIMATING", "SUBMITTED", "SHORTLISTED"];

export const BID_OUTCOME_LABEL: Record<BidOutcome, string> = {
  AWARDED: "Awarded",
  LOST: "Lost",
  NO_BID: "Passed (no bid)",
  CANCELLED: "Cancelled by the GC",
  NO_DECISION: "No decision",
  REBID: "Rebid",
};

/** What closing with an outcome must carry. */
export function closeRequires(outcome: BidOutcome): { lossReason: boolean; awardedAmount: boolean } {
  return { lossReason: outcome === "LOST", awardedAmount: outcome === "AWARDED" };
}

/** Which lead stage flag an outcome mirrors; "open" = the first open stage (a reopen). */
export function leadStageFor(outcome: BidOutcome | null): "won" | "lost" | "open" {
  if (outcome === "AWARDED") return "won";
  if (outcome === "LOST" || outcome === "NO_BID" || outcome === "CANCELLED" || outcome === "NO_DECISION") return "lost";
  return "open";
}

export function bidNumber(n: number): string {
  return `BID-${String(n).padStart(5, "0")}`;
}

/** The newest version's amount, or nothing submitted yet. */
export function latestAmount(submissions: readonly { version: number; amount: number | string }[]): number | null {
  if (submissions.length === 0) return null;
  const top = [...submissions].sort((a, b) => b.version - a.version)[0]!;
  return Number(top.amount);
}
