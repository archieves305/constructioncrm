import type { Tone } from "@/lib/ui/tones";

/**
 * Presentation for the template estimate's status. Kept out of the panel so
 * the mapping is testable and the job / lead surfaces agree.
 */
export type EstimateStatusValue = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";

export const ESTIMATE_STATUS_TONE: Record<EstimateStatusValue, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  DECLINED: "danger",
};

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatusValue, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};

/** The status changes the panel menu offers from a given status. */
export const ESTIMATE_STATUS_ACTIONS: { to: EstimateStatusValue; label: string }[] = [
  { to: "SENT", label: "Mark sent" },
  { to: "ACCEPTED", label: "Mark accepted" },
  { to: "DECLINED", label: "Mark declined" },
  { to: "DRAFT", label: "Back to draft" },
];

export function isEstimateStatus(value: string): value is EstimateStatusValue {
  return Object.hasOwn(ESTIMATE_STATUS_TONE, value);
}

/** A contract is generated from an accepted estimate only. */
export function canGenerateContractFromEstimate(status: string): boolean {
  return status === "ACCEPTED";
}
