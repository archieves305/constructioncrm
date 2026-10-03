/**
 * Trigger names the follow-up rule engine once took from permits and
 * inspections. Retired 2026-10-03: nothing emits them any more — permit
 * follow-ups are ordinary tasks (`lib/permits/alert-run.ts`) and no customer
 * mail is sent on a permit event. The names stay so rules that carry them can
 * still be read and switched off under Admin → Follow-up rules.
 */

export const PERMIT_EVENTS = [
  "PERMIT_CREATED",
  "PERMIT_STATUS_APPLIED",
  "PERMIT_STATUS_IN_PROGRESS",
  "PERMIT_STATUS_ISSUED",
  "PERMIT_STATUS_FINAL",
  "PERMIT_STATUS_EXPIRED",
  "PERMIT_STATUS_DENIED",
  "PERMIT_AGING_7D",
  "PERMIT_AGING_14D",
  "PERMIT_EXPIRING_30D",
] as const;

export const INSPECTION_EVENTS = [
  "INSPECTION_SCHEDULED",
  "INSPECTION_REMINDER_24H",
  "INSPECTION_PASSED",
  "INSPECTION_FAILED",
  "INSPECTION_CONDITIONAL",
  "INSPECTION_CANCELLED",
] as const;

export type PermitEvent = (typeof PERMIT_EVENTS)[number];
export type InspectionEvent = (typeof INSPECTION_EVENTS)[number];
