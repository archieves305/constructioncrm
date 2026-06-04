import type { NormalizedProperty } from "./normalize";
import { estimateRoofAge, type RoofAgeEstimate } from "./roof-age";
import {
  DEFAULT_SCORING_CONFIG,
  type ScoreBand,
  type ScoringConfig,
} from "./scoring-config";

// ─── Knock Score calculator (spec §3) ─────────────────────────────────────────
// Pure. Every threshold comes from `config`; missing inputs fall through to the
// spec's "unknown" rules and contribute 0 rather than throwing. Each section is
// clamped to its own max, and the total is clamped 0–100.

export type ScoreBreakdown = {
  roof: number;
  financial: number;
  conversion: number;
  personalization: number;
  roofAge: RoofAgeEstimate;
  equityPercentage: number | null;
  yearsOwned: number | null;
};

export type KnockScoreResult = {
  score: number;
  tier: string;
  breakdown: ScoreBreakdown;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Pick the first band (in config order, low→high) whose `max` is open-ended or
// at/above `value`. Returns 0 points when `value` is null or no band matches.
function bandPoints(bands: ScoreBand[], value: number | null): number {
  if (value == null) return 0;
  for (const b of bands) {
    if (b.max == null || value <= b.max) return b.points;
  }
  return bands.length ? bands[bands.length - 1].points : 0;
}

function roofScore(
  n: NormalizedProperty,
  roofAge: RoofAgeEstimate,
  cfg: ScoringConfig["roof"],
  now: Date,
): number {
  // Roof age component.
  let agePoints = 0;
  if (roofAge.years != null) {
    if (roofAge.basis === "permit") {
      agePoints = bandPoints(cfg.ageBands, roofAge.years);
    } else if (roofAge.basis === "yearBuilt") {
      // Roof age is only inferred from the home's age — old home but unconfirmed
      // roof: cap at the "unknown age but built 20+" value rather than the full
      // confirmed-old-roof band.
      agePoints =
        roofAge.years >= 20
          ? cfg.unknownAgeBuiltOver20Points
          : bandPoints(cfg.ageBands, roofAge.years);
    }
  }

  // Permit-history modifiers.
  const builtAge = n.yearBuilt != null ? now.getFullYear() - n.yearBuilt : null;
  const permitAge = n.lastRoofPermitDate
    ? now.getFullYear() - Number(n.lastRoofPermitDate.slice(0, 4))
    : null;

  let permitMods = 0;
  if (!n.hasRoofPermit && builtAge != null && builtAge >= 15) {
    permitMods += cfg.permitNoneBuilt15PlusBonus;
  }
  if (n.hasRoofPermit && permitAge != null && permitAge <= 10) {
    permitMods -= cfg.permitWithin10YearsPenalty;
  }
  if (n.hasRoofPermit && permitAge != null && permitAge > 15) {
    permitMods += cfg.permitOlderThan15YearsBonus;
  }

  return clamp(agePoints + permitMods, 0, cfg.maxPoints);
}

function financialScore(
  n: NormalizedProperty,
  cfg: ScoringConfig["financial"],
): number {
  return clamp(bandPoints(cfg.equityBands, n.equityPercentage), 0, cfg.maxPoints);
}

function conversionScore(
  n: NormalizedProperty,
  cfg: ScoringConfig["conversion"],
  now: Date,
): number {
  let occupancy: number;
  if (n.ownerOccupied === true) occupancy = cfg.ownerOccupiedPoints;
  else if (n.ownerOccupied === false) occupancy = cfg.absenteePoints;
  else occupancy = cfg.unknownOccupancyPoints;

  const yearsOwned = n.ownedSince != null ? now.getFullYear() - n.ownedSince : null;
  const ownership = bandPoints(cfg.ownershipBands, yearsOwned);

  return clamp(occupancy + ownership, 0, cfg.maxPoints);
}

function personalizationScore(
  n: NormalizedProperty,
  cfg: ScoringConfig["personalization"],
): number {
  let pts = 0;
  if (n.ownerName) pts += cfg.ownerNamePoints;
  if (n.roofType) pts += cfg.roofTypePoints;
  // "Sufficient detail for a custom pitch": enough to personalize beyond a name.
  if (n.yearBuilt != null && n.estimatedValue != null) {
    pts += cfg.sufficientDetailPoints;
  }
  return clamp(pts, 0, cfg.maxPoints);
}

export function tierFor(score: number, config: ScoringConfig): string {
  const tiers = [...config.tiers].sort((a, b) => b.min - a.min);
  for (const t of tiers) {
    if (score >= t.min) return t.label;
  }
  return tiers.length ? tiers[tiers.length - 1].label : "";
}

export function computeKnockScore(
  n: NormalizedProperty,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  now: Date = new Date(),
): KnockScoreResult {
  const roofAge = estimateRoofAge(n, now);

  const roof = roofScore(n, roofAge, config.roof, now);
  const financial = financialScore(n, config.financial);
  const conversion = conversionScore(n, config.conversion, now);
  const personalization = personalizationScore(n, config.personalization);

  const score = clamp(roof + financial + conversion + personalization, 0, 100);

  return {
    score,
    tier: tierFor(score, config),
    breakdown: {
      roof,
      financial,
      conversion,
      personalization,
      roofAge,
      equityPercentage: n.equityPercentage,
      yearsOwned: n.ownedSince != null ? now.getFullYear() - n.ownedSince : null,
    },
  };
}
