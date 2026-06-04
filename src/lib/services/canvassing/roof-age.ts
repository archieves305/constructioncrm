import type { NormalizedProperty } from "./normalize";

// ─── Estimated roof age (spec §4) ─────────────────────────────────────────────
// Priority 1: most recent roof-permit date.
// Priority 2: year built (an approximation, flagged as such).
// Priority 3: unknown.
// `now` is injectable so scoring/tests are deterministic.

export type RoofAgeBasis = "permit" | "yearBuilt" | "unknown";

export type RoofAgeEstimate = {
  years: number | null;
  basis: RoofAgeBasis;
};

function yearsSince(year: number | null, now: Date): number | null {
  if (year == null) return null;
  const age = now.getFullYear() - year;
  return age >= 0 ? age : null;
}

export function estimateRoofAge(
  n: NormalizedProperty,
  now: Date = new Date(),
): RoofAgeEstimate {
  const permitYear = n.lastRoofPermitDate
    ? Number(n.lastRoofPermitDate.slice(0, 4))
    : null;
  const fromPermit = yearsSince(
    Number.isFinite(permitYear) ? permitYear : null,
    now,
  );
  if (fromPermit != null) return { years: fromPermit, basis: "permit" };

  const fromBuilt = yearsSince(n.yearBuilt, now);
  if (fromBuilt != null) return { years: fromBuilt, basis: "yearBuilt" };

  return { years: null, basis: "unknown" };
}

// Human-readable line for cards/modal (spec §4 display rules).
export function formatRoofAge(estimate: RoofAgeEstimate): string {
  if (estimate.years == null) return "Unknown";
  if (estimate.basis === "permit") return `${estimate.years} years`;
  return `Approx. ${estimate.years} years based on year built`;
}
