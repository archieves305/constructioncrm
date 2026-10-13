import { z } from "zod";

/**
 * Bid / no-bid, 0–100, advisory. Pure and config-driven: every band and
 * point value comes from `BidWeights` (stored as JSON in PartnerSettings and
 * validated here), the scorer never hard-codes a threshold, and every
 * decision snapshots the weights version with its inputs so a later edit
 * never rewrites history. AUTO factors come from the record; the five
 * MANUAL ones are 1–5 sliders the person sets at decision time. Gates only
 * move the recommendation down. A human decides; this is advice.
 */

const band = z.object({ max: z.number().nullable(), points: z.number() });
const bands = z.array(band).min(1);

export const bidWeightsSchema = z.object({
  relationship: z.object({ max: z.number(), factor: z.number() }), // healthScore × factor
  size: z.object({ inRange: z.number(), near: z.number(), far: z.number(), unknown: z.number(), max: z.number() }),
  tradeFit: z.object({ all: z.number(), some: z.number(), none: z.number(), max: z.number() }),
  market: z.object({ home: z.number(), adjacent: z.number(), other: z.number(), unknown: z.number(), max: z.number() }),
  leadTime: z.object({ bands: bands, unknown: z.number(), max: z.number() }), // days to due, ascending max
  payment: z.object({ bands: bands, unknown: z.number(), max: z.number() }), // avg days to pay, ascending max
  winRate: z.object({ minSubmissions: z.number().int(), bands: bands, unknown: z.number(), max: z.number() }), // rate ascending max
  insuranceLapsedPenalty: z.number(),
  manual: z.object({ margin: z.number(), capacity: z.number(), competition: z.number(), complexity: z.number(), plansAndTerms: z.number() }), // points per slider step (1–5)
  bands: z.object({ bid: z.number(), review: z.number() }), // score ≥ bid → BID; ≥ review → REVIEW; else NO_BID
});
export type BidWeights = z.infer<typeof bidWeightsSchema>;

export const DEFAULT_BID_WEIGHTS: BidWeights = {
  relationship: { max: 15, factor: 0.15 },
  size: { inRange: 10, near: 6, far: 2, unknown: 5, max: 10 },
  tradeFit: { all: 10, some: 5, none: 0, max: 10 },
  market: { home: 10, adjacent: 6, other: 2, unknown: 5, max: 10 },
  leadTime: { bands: [{ max: 4, points: 0 }, { max: 9, points: 3 }, { max: null, points: 5 }], unknown: 3, max: 5 },
  payment: { bands: [{ max: 30, points: 10 }, { max: 45, points: 7 }, { max: 60, points: 3 }, { max: null, points: 0 }], unknown: 5, max: 10 },
  winRate: { minSubmissions: 3, bands: [{ max: 0.19, points: 1 }, { max: 0.39, points: 3 }, { max: null, points: 5 }], unknown: 3, max: 5 },
  insuranceLapsedPenalty: 5,
  manual: { margin: 2, capacity: 2, competition: 1, complexity: 1, plansAndTerms: 1 },
  bands: { bid: 70, review: 50 },
};

export type Slider = 1 | 2 | 3 | 4 | 5 | null;

export type BidScoreInput = {
  healthScore: number | null;
  estimatedValue: number | null;
  typicalRange: { min: number; max: number } | null;
  packageTradeIds: string[];
  ourTradeIds: string[];
  county: string | null;
  homeCounties: string[];
  adjacentCounties: string[];
  daysToDue: number | null;
  avgDaysToPay: number | null;
  decidedSubmissions: number;
  awards: number;
  insuranceCurrent: boolean | null;
  bondRequired: boolean;
  bondingCapacity: number | null;
  manual: { margin: Slider; capacity: Slider; competition: Slider; complexity: Slider; plansAndTerms: Slider };
};

export type FactorResult = { points: number; max: number; note: string; mode: "AUTO" | "MANUAL" | "GATE" };
export type BidScore = {
  score: number;
  recommendation: "BID" | "REVIEW" | "NO_BID";
  reasons: string[];
  concerns: string[];
  gates: string[];
  breakdown: Record<string, FactorResult>;
  weightsVersion: number;
};

function pickBand(value: number, list: { max: number | null; points: number }[]): number {
  for (const b of list) if (b.max === null || value <= b.max) return b.points;
  return list[list.length - 1]!.points;
}

const norm = (s: string) => s.trim().toLowerCase();

export function scoreBid(input: BidScoreInput, w: BidWeights = DEFAULT_BID_WEIGHTS, weightsVersion = 1): BidScore {
  const breakdown: Record<string, FactorResult> = {};
  const concerns: string[] = [];
  const gates: string[] = [];

  // Relationship (health score, Stage 4; neutral = half until then)
  const rel = input.healthScore === null ? w.relationship.max / 2 : Math.min(w.relationship.max, input.healthScore * w.relationship.factor);
  breakdown.relationship = { points: round(rel), max: w.relationship.max, note: input.healthScore === null ? "No relationship score yet" : `Relationship health ${input.healthScore}/100`, mode: "AUTO" };
  if (input.healthScore === null) concerns.push("No relationship score yet (the health score arrives with Stage 4)");

  // Size vs typical
  if (input.estimatedValue === null || !input.typicalRange) {
    breakdown.size = { points: w.size.unknown, max: w.size.max, note: input.estimatedValue === null ? "Contract value unknown" : "No typical range set for this trade", mode: "AUTO" };
    concerns.push(input.estimatedValue === null ? "No estimated contract value on the bid" : "No typical project size set for this trade under Admin → Business Development");
  } else {
    const { min, max } = input.typicalRange;
    const v = input.estimatedValue;
    const inRange = v >= min && v <= max;
    const near = v >= min / 2 && v <= max * 2;
    const pts = inRange ? w.size.inRange : near ? w.size.near : w.size.far;
    breakdown.size = { points: pts, max: w.size.max, note: inRange ? `${usd(v)} sits inside KNU's usual ${usd(min)}–${usd(max)}` : near ? `${usd(v)} is near KNU's usual range` : `${usd(v)} is far from KNU's usual ${usd(min)}–${usd(max)}`, mode: "AUTO" };
    if (!near) concerns.push(breakdown.size.note);
  }

  // Trade fit — a gate
  const ours = new Set(input.ourTradeIds);
  const fit = input.packageTradeIds.length === 0 ? "none" : input.packageTradeIds.every((t) => ours.has(t)) ? "all" : input.packageTradeIds.some((t) => ours.has(t)) ? "some" : "none";
  breakdown.tradeFit = { points: w.tradeFit[fit], max: w.tradeFit.max, note: fit === "all" ? "Every trade in the package is one KNU performs" : fit === "some" ? "Part of the package is outside KNU's trades" : input.packageTradeIds.length === 0 ? "No trade on the package" : "None of the package's trades are KNU's", mode: "GATE" };
  if (fit === "none") gates.push(input.packageTradeIds.length === 0 ? "No trade is set on the package" : "The package's trades are not ones KNU performs");
  if (fit === "some") concerns.push("Part of the scope is outside KNU's trades — subcontract or carve out");

  // Market
  const county = input.county ? norm(input.county) : null;
  const home = input.homeCounties.map(norm);
  const adjacent = input.adjacentCounties.map(norm);
  const marketPts = county === null ? w.market.unknown : home.includes(county) ? w.market.home : adjacent.includes(county) ? w.market.adjacent : w.market.other;
  breakdown.market = { points: marketPts, max: w.market.max, note: county === null ? "No county on the site address" : home.includes(county) ? `${input.county} is a home market` : adjacent.includes(county) ? `${input.county} is within reach` : `${input.county} is outside KNU's markets`, mode: "AUTO" };
  if (county !== null && !home.includes(county) && !adjacent.includes(county)) concerns.push(breakdown.market.note);

  // Lead time
  const lt = input.daysToDue === null ? w.leadTime.unknown : pickBand(input.daysToDue, w.leadTime.bands);
  breakdown.leadTime = { points: lt, max: w.leadTime.max, note: input.daysToDue === null ? "No due date" : input.daysToDue < 0 ? `Due ${-input.daysToDue} day(s) ago` : `${input.daysToDue} day(s) to bid`, mode: "AUTO" };
  if (input.daysToDue !== null && input.daysToDue < 5) concerns.push(input.daysToDue < 0 ? "The due date has passed" : `Only ${input.daysToDue} day(s) to bid`);

  // Payment history
  const pay = input.avgDaysToPay === null ? w.payment.unknown : pickBand(input.avgDaysToPay, w.payment.bands);
  breakdown.payment = { points: pay, max: w.payment.max, note: input.avgDaysToPay === null ? "No payment history with this GC" : `Pays in ${Math.round(input.avgDaysToPay)} days on average`, mode: "AUTO" };
  if (input.avgDaysToPay === null) concerns.push("No payment history with this GC yet");
  else if (input.avgDaysToPay > 60) concerns.push(`Slow payer: ${Math.round(input.avgDaysToPay)} days on average`);

  // Win rate with this GC
  if (input.decidedSubmissions < w.winRate.minSubmissions) {
    breakdown.winRate = { points: w.winRate.unknown, max: w.winRate.max, note: `${input.decidedSubmissions} decided bid(s) with this GC — too few to read`, mode: "AUTO" };
  } else {
    const rate = input.awards / input.decidedSubmissions;
    breakdown.winRate = { points: pickBand(rate, w.winRate.bands), max: w.winRate.max, note: `Won ${input.awards} of ${input.decidedSubmissions} with this GC (${Math.round(rate * 100)}%)`, mode: "AUTO" };
    if (rate < 0.2) concerns.push(breakdown.winRate.note);
  }

  // Insurance
  if (input.insuranceCurrent === false) {
    breakdown.insurance = { points: -w.insuranceLapsedPenalty, max: 0, note: "A required insurance document in the vault has lapsed", mode: "AUTO" };
    concerns.push("A required insurance document has lapsed — renew it before submitting");
  } else {
    breakdown.insurance = { points: 0, max: 0, note: input.insuranceCurrent === null ? "No qualification checklist to read insurance from" : "Insurance documents are current", mode: "AUTO" };
  }

  // Bonding gate
  if (input.bondRequired && (input.bondingCapacity === null || input.bondingCapacity <= 0)) gates.push("A bond is required and KNU's bonding capacity is not set");
  else if (input.bondRequired && input.estimatedValue !== null && input.bondingCapacity !== null && input.estimatedValue > input.bondingCapacity) gates.push(`A bond is required and ${usd(input.estimatedValue)} exceeds KNU's bonding capacity of ${usd(input.bondingCapacity)}`);
  breakdown.bonding = { points: 0, max: 0, note: input.bondRequired ? (gates.some((g) => g.startsWith("A bond")) ? "Bond required — see concerns" : "Bond required, within capacity") : "No bond required", mode: "GATE" };

  // Manual sliders
  const manualDefs: { key: keyof BidScoreInput["manual"]; label: string; per: number }[] = [
    { key: "margin", label: "Expected margin", per: w.manual.margin },
    { key: "capacity", label: "Workforce and estimator capacity", per: w.manual.capacity },
    { key: "competition", label: "Competition", per: w.manual.competition },
    { key: "complexity", label: "Complexity and risk", per: w.manual.complexity },
    { key: "plansAndTerms", label: "Plans quality and contract terms", per: w.manual.plansAndTerms },
  ];
  for (const d of manualDefs) {
    const v = input.manual[d.key];
    const max = d.per * 5;
    if (v === null) {
      breakdown[d.key] = { points: 0, max, note: `${d.label}: not rated`, mode: "MANUAL" };
      concerns.push(`${d.label} not rated`);
    } else {
      breakdown[d.key] = { points: d.per * v, max, note: `${d.label}: ${v}/5`, mode: "MANUAL" };
      if (v <= 2) concerns.push(`${d.label} rated ${v}/5`);
    }
  }

  const raw = Object.values(breakdown).reduce((s, f) => s + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  let recommendation: BidScore["recommendation"] = score >= w.bands.bid ? "BID" : score >= w.bands.review ? "REVIEW" : "NO_BID";
  if (gates.some((g) => g.startsWith("A bond")) && recommendation === "BID") recommendation = "REVIEW";
  if (fit === "none") recommendation = "NO_BID";

  const reasons = Object.values(breakdown)
    .filter((f) => f.max > 0 && f.points / f.max >= 0.7)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => f.note);

  return { score, recommendation, reasons, concerns, gates, breakdown, weightsVersion };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const RECOMMENDATION_LABEL: Record<BidScore["recommendation"], string> = { BID: "Bid", REVIEW: "Review before bidding", NO_BID: "Pass" };
