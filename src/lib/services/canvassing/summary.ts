import type { NormalizedProperty } from "./normalize";
import type { KnockScoreResult } from "./score";
import { formatRoofAge } from "./roof-age";
import {
  DEFAULT_COMPLIANCE_DISCLAIMER,
  DEFAULT_OPENING_SCRIPT,
} from "./scoring-config";

// ─── Canvasser One-Screen Summary (spec §6–8) ─────────────────────────────────
// Builds the field-ready summary a canvasser reads on their phone in front of the
// door: why it matters, what to say first, the angles to lean on, and what to
// avoid. Pure. All script generation is dynamic (spec §8) and deliberately avoids
// the prohibited phrasing in spec §13.

export type CanvasserSummary = {
  knockScore: number;
  tier: string;
  priority: "high" | "medium" | "low"; // green / yellow / red
  reasons: string[]; // "Why This Door Matters"
  recommendedOpening: string;
  phoneScript: string; // tap-to-copy phone/absentee outreach
  talkingPoints: string[];
  financingAngle: string | null;
  insuranceAngle: string | null;
  cautionNotes: string[];
  disclaimer: string;
  isAbsentee: boolean;
};

export type SummaryOptions = {
  canvasserName?: string | null;
  companyName?: string;
  defaultOpeningScript?: string;
  complianceDisclaimer?: string;
  highEquityThreshold?: number;
};

const money = (n: number | null | undefined) =>
  n == null ? "Unknown" : `$${Math.round(n).toLocaleString("en-US")}`;

function equityText(n: NormalizedProperty): string {
  if (n.estimatedEquity == null) return "Unknown";
  const pct = n.equityPercentage != null ? ` / ${n.equityPercentage}%` : "";
  return `${money(n.estimatedEquity)}${pct}`;
}

function firstName(ownerName: string | null): string {
  if (!ownerName) return "there";
  return ownerName.trim().split(/\s+/)[0] || "there";
}

function priorityFor(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function buildCanvasserSummary(
  n: NormalizedProperty,
  result: KnockScoreResult,
  opts: SummaryOptions = {},
): CanvasserSummary {
  const {
    canvasserName,
    companyName = "NewCoast Roofing",
    defaultOpeningScript = DEFAULT_OPENING_SCRIPT,
    complianceDisclaimer = DEFAULT_COMPLIANCE_DISCLAIMER,
    highEquityThreshold = 60,
  } = opts;

  const roofAge = result.breakdown.roofAge;
  const canvasser = canvasserName?.trim() || "[Canvasser Name]";
  const owner = firstName(n.ownerName);
  const isAbsentee = n.ownerOccupied === false;
  const highEquity =
    n.equityPercentage != null && n.equityPercentage >= highEquityThreshold;
  const builtAge =
    n.yearBuilt != null ? new Date().getFullYear() - n.yearBuilt : null;
  const olderHome = (roofAge.years ?? builtAge ?? 0) >= 15;

  // ── Why This Door Matters ──────────────────────────────────────────────────
  const reasons: string[] = [];
  if (roofAge.years != null) {
    reasons.push(
      roofAge.basis === "permit"
        ? `Roof is approximately ${roofAge.years} years old (last roof permit on record).`
        : `Roof may be around ${roofAge.years} years old, estimated from the year built.`,
    );
  } else {
    reasons.push("Roof age is unknown from available records.");
  }
  if (n.yearBuilt != null) reasons.push(`Property was built in ${n.yearBuilt}.`);
  if (n.ownedSince != null) {
    const yrs = result.breakdown.yearsOwned;
    reasons.push(
      `Owner has owned the home since ${n.ownedSince}${yrs != null ? ` (~${yrs} years)` : ""}.`,
    );
  }
  if (n.estimatedEquity != null) {
    reasons.push(`Estimated equity is ${equityText(n)}.`);
  }
  reasons.push(
    n.ownerOccupied === true
      ? "Appears owner-occupied."
      : isAbsentee
        ? "Appears to be an absentee owner."
        : "Owner-occupancy is unknown.",
  );

  // ── Recommended opening (spec §8, dynamic) ─────────────────────────────────
  let recommendedOpening: string;
  if (isAbsentee) {
    recommendedOpening =
      `Likely absentee owner — door-knocking is lower priority here. If you do ` +
      `make contact: “Hi, I’m ${canvasser} with ${companyName}. We’re offering ` +
      `complimentary roof inspections for homes in this neighborhood this week.”`;
  } else if (roofAge.years != null && n.ownerName) {
    recommendedOpening =
      `Hi ${owner}, I’m ${canvasser} with ${companyName}. We’re helping homeowners ` +
      `in the area whose roofs are reaching the age where insurance and storm ` +
      `season become a bigger concern. Based on neighborhood property records this ` +
      `home may be in that range, so we’re offering complimentary inspections this ` +
      `week. Would mornings or afternoons work better for a quick look?`;
  } else if (olderHome) {
    recommendedOpening =
      `Hi ${owner}, I’m ${canvasser} with ${companyName}. We’re working with ` +
      `homeowners in this neighborhood because many homes were built around the ` +
      `same time and may be due for a roof inspection before storm season. We’re ` +
      `offering complimentary inspections this week — would now or later this week ` +
      `be easier?`;
  } else {
    recommendedOpening = defaultOpeningScript
      .replace(/\[Owner Name\]/g, owner)
      .replace(/\[Canvasser Name\]/g, canvasser);
  }

  const phoneScript =
    `Hi, is this ${n.ownerName ?? "the homeowner"}? I’m ${canvasser} with ` +
    `${companyName}. We’re offering complimentary roof inspections in your ` +
    `neighborhood this week — older roofs can raise insurance and storm-season ` +
    `concerns here in Florida. Could I set up a quick, no-obligation look?`;

  // ── Talking points (spec §7) ───────────────────────────────────────────────
  const talkingPoints = [
    roofAge.years != null
      ? `Roof age (≈ ${formatRoofAge(roofAge)})`
      : "Roof age",
    "Insurance renewal concerns",
    "Hurricane readiness",
    "Complimentary inspection",
    "Financing options if a roof replacement is needed",
    "PACE or GreenSky may be available depending on eligibility",
  ];

  // ── Angles ─────────────────────────────────────────────────────────────────
  const financingAngle = highEquity
    ? "This homeowner may have stronger financing options given estimated equity — " +
      "mention PACE or traditional contractor financing, depending on eligibility."
    : null;

  const insuranceAngle = olderHome
    ? "Older roofs can create insurance concerns in Florida, especially during " +
      "renewal or when storm damage is suspected."
    : null;

  // ── Caution notes (spec §7 & §13) — always present ─────────────────────────
  const cautionNotes = [
    "Do not promise insurance approval or interpret policy coverage.",
    "Do not say financing is guaranteed.",
    "Do not state exact roof age unless verified by permit.",
    "Do not claim to know the homeowner’s equity.",
    "Keep the conversation natural and respectful — no overly personal language.",
  ];
  if (isAbsentee) {
    cautionNotes.unshift(
      "Likely absentee owner — consider phone, mail, or email outreach instead of door-knocking.",
    );
  }

  return {
    knockScore: result.score,
    tier: result.tier,
    priority: priorityFor(result.score),
    reasons,
    recommendedOpening,
    phoneScript,
    talkingPoints,
    financingAngle,
    insuranceAngle,
    cautionNotes,
    disclaimer: complianceDisclaimer,
    isAbsentee,
  };
}
