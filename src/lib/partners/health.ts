import { z } from "zod";

/**
 * Relationship health, 0–100, computed on read (plan §17). Pure and
 * config-driven: every band and point value lives in `HealthWeights`
 * (PartnerSettings.healthWeights, validated here, defaults below) and the
 * version is returned with the score. Four sections — engagement,
 * qualification, bid flow, economics — then a dormant cap so old revenue
 * cannot keep a dead relationship reading healthy. Strengths, weaknesses and
 * the recommended action are rule-generated; nothing here is written by AI.
 */

const step = z.object({ min: z.number(), points: z.number() }); // value ≥ min → points (checked high to low)
const steps = z.array(step).min(1);
const ceiling = z.object({ max: z.number(), points: z.number() }); // value ≤ max → points (checked low to high)
const ceilings = z.array(ceiling).min(1);

export const healthWeightsSchema = z.object({
  engagement: z.object({ recencyDays: ceilings, meetings365: steps, interactions90: steps }),
  qualification: z.object({ approvedFar: z.number(), approvedNearDays: z.number(), approvedNear: z.number(), submitted: z.number(), inProgress: z.number(), expired: z.number(), none: z.number() }),
  bidFlow: z.object({ invitations365: steps, submitRatio: z.number(), submitRatioBonus: z.number(), awards365: steps }),
  economics: z.object({ revenue365: steps, margin: steps, daysToPay: ceilings }),
  dormantAfterDays: z.number().int().min(1),
  dormantCap: z.number().min(0).max(100),
  bands: z.object({ strong: z.number(), active: z.number(), developing: z.number(), cold: z.number() }),
  slowPayerDays: z.number(),
  quietDays: z.number(),
  expiringDays: z.number(),
});
export type HealthWeights = z.infer<typeof healthWeightsSchema>;

export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  engagement: {
    recencyDays: [{ max: 14, points: 15 }, { max: 30, points: 12 }, { max: 60, points: 8 }, { max: 90, points: 4 }],
    meetings365: [{ min: 2, points: 8 }, { min: 1, points: 5 }],
    interactions90: [{ min: 5, points: 7 }, { min: 2, points: 4 }, { min: 1, points: 2 }],
  },
  qualification: { approvedFar: 20, approvedNearDays: 90, approvedNear: 14, submitted: 10, inProgress: 5, expired: 2, none: 0 },
  bidFlow: { invitations365: [{ min: 4, points: 14 }, { min: 2, points: 10 }, { min: 1, points: 6 }], submitRatio: 0.5, submitRatioBonus: 4, awards365: [{ min: 2, points: 7 }, { min: 1, points: 5 }] },
  economics: {
    revenue365: [{ min: 500_000, points: 10 }, { min: 100_000, points: 7 }, { min: 25_000, points: 4 }, { min: 0.01, points: 2 }],
    margin: [{ min: 0.25, points: 8 }, { min: 0.15, points: 5 }, { min: 0.05, points: 2 }],
    daysToPay: [{ max: 30, points: 7 }, { max: 45, points: 5 }, { max: 60, points: 2 }],
  },
  dormantAfterDays: 180,
  dormantCap: 40,
  bands: { strong: 80, active: 60, developing: 40, cold: 20 },
  slowPayerDays: 60,
  quietDays: 60,
  expiringDays: 60,
};

export type HealthInput = {
  lastContactAt: Date | string | null;
  createdAt: Date | string;
  meetings365: number;
  interactions90: number;
  qualification: { status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "INFO_REQUESTED" | "APPROVED" | "REJECTED"; expiresAt: Date | string | null } | null;
  invitations365: number;
  submitted365: number;
  awards365: number;
  /** Σ invoiced on the account's jobs in the last 365 days. */
  revenue365: number;
  /** Projected margin across the account's billable jobs; null with none. */
  margin: number | null;
  /** Mean days from invoice to payment over the last 365 days; null with no linked payment. */
  daysToPay: number | null;
  primaryContactName: string | null;
};

export type HealthBand = "STRONG" | "ACTIVE" | "DEVELOPING" | "COLD" | "DORMANT";
export type HealthSection = "engagement" | "qualification" | "bidFlow" | "economics";
export type HealthFactor = { key: string; label: string; points: number; max: number; note: string };
export type HealthResult = {
  score: number;
  band: HealthBand;
  capped: boolean;
  breakdown: Record<HealthSection, { points: number; max: number; factors: HealthFactor[] }>;
  strengths: string[];
  weaknesses: string[];
  recommendedAction: string;
  weightsVersion: number;
};

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = { STRONG: "Strong", ACTIVE: "Active", DEVELOPING: "Developing", COLD: "Cold", DORMANT: "Dormant" };
export const HEALTH_SECTION_LABEL: Record<HealthSection, string> = { engagement: "Engagement", qualification: "Qualification", bidFlow: "Bid flow", economics: "Economics" };

const MS_DAY = 86_400_000;
const at = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();
const atLeast = (v: number, list: { min: number; points: number }[]) => [...list].sort((a, b) => b.min - a.min).find((s) => v >= s.min)?.points ?? 0;
const atMost = (v: number, list: { max: number; points: number }[]) => [...list].sort((a, b) => a.max - b.max).find((s) => v <= s.max)?.points ?? 0;
const maxOf = (list: { points: number }[]) => Math.max(0, ...list.map((s) => s.points));
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dayLabel = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function scoreHealth(input: HealthInput, w: HealthWeights = DEFAULT_HEALTH_WEIGHTS, weightsVersion = 1, now: Date = new Date()): HealthResult {
  const touched = input.lastContactAt ? Math.floor((now.getTime() - at(input.lastContactAt)) / MS_DAY) : null;

  // Engagement
  const rec = touched === null ? 0 : atMost(touched, w.engagement.recencyDays);
  const mt = atLeast(input.meetings365, w.engagement.meetings365);
  const ix = atLeast(input.interactions90, w.engagement.interactions90);
  const engagement = {
    factors: [
      { key: "recency", label: "Last touch", points: rec, max: maxOf(w.engagement.recencyDays), note: touched === null ? "Never contacted" : touched === 0 ? "Touched today" : `Last touch ${touched} days ago` },
      { key: "meetings", label: "Meetings", points: mt, max: maxOf(w.engagement.meetings365), note: `${input.meetings365} meeting${input.meetings365 === 1 ? "" : "s"} in 12 months` },
      { key: "interactions", label: "Touches", points: ix, max: maxOf(w.engagement.interactions90), note: `${input.interactions90} touch${input.interactions90 === 1 ? "" : "es"} in 90 days` },
    ],
  };

  // Qualification
  const q = input.qualification;
  const qw = w.qualification;
  let qPts = qw.none;
  let qNote = "No prequalification";
  let expiresIn: number | null = null;
  if (q) {
    if (q.status === "APPROVED") {
      expiresIn = q.expiresAt ? Math.floor((at(q.expiresAt) - now.getTime()) / MS_DAY) : null;
      if (expiresIn !== null && expiresIn < 0) [qPts, qNote] = [qw.expired, "Prequalification expired"];
      else if (expiresIn !== null && expiresIn <= qw.approvedNearDays) [qPts, qNote] = [qw.approvedNear, `Prequalified, expires in ${expiresIn} days`];
      else [qPts, qNote] = [qw.approvedFar, expiresIn === null ? "Prequalified" : `Prequalified, ${expiresIn} days left`];
    } else if (q.status === "SUBMITTED" || q.status === "INFO_REQUESTED") [qPts, qNote] = [qw.submitted, q.status === "INFO_REQUESTED" ? "Prequalification: they asked for more" : "Prequalification submitted"];
    else if (q.status === "IN_PROGRESS") [qPts, qNote] = [qw.inProgress, "Prequalification in progress"];
    else if (q.status === "REJECTED") [qPts, qNote] = [qw.none, "Prequalification rejected"];
    else [qPts, qNote] = [qw.none, "Prequalification not started"];
  }
  const qMax = Math.max(qw.approvedFar, qw.approvedNear, qw.submitted, qw.inProgress, qw.expired, qw.none);
  const qualification = { factors: [{ key: "prequal", label: "Prequalification", points: qPts, max: qMax, note: qNote }] };

  // Bid flow
  const inv = atLeast(input.invitations365, w.bidFlow.invitations365);
  const ratioOk = input.invitations365 > 0 && input.submitted365 / input.invitations365 >= w.bidFlow.submitRatio;
  const aw = atLeast(input.awards365, w.bidFlow.awards365);
  const bidFlow = {
    factors: [
      { key: "invitations", label: "Invitations", points: inv, max: maxOf(w.bidFlow.invitations365), note: input.invitations365 === 0 ? "No invitations in 12 months" : input.invitations365 === 1 ? "One invitation in 12 months" : `${input.invitations365} invitations in 12 months` },
      { key: "submitRatio", label: "Bids submitted", points: ratioOk ? w.bidFlow.submitRatioBonus : 0, max: w.bidFlow.submitRatioBonus, note: input.invitations365 === 0 ? "Nothing to submit" : `Submitted ${input.submitted365} of ${input.invitations365}` },
      { key: "awards", label: "Awards", points: aw, max: maxOf(w.bidFlow.awards365), note: input.awards365 === 0 ? "No award in 12 months" : `${input.awards365} award${input.awards365 === 1 ? "" : "s"} in 12 months` },
    ],
  };

  // Economics
  const rv = input.revenue365 > 0 ? atLeast(input.revenue365, w.economics.revenue365) : 0;
  const mg = input.margin === null ? 0 : atLeast(input.margin, w.economics.margin);
  const dp = input.daysToPay === null ? 0 : atMost(input.daysToPay, w.economics.daysToPay);
  const economics = {
    factors: [
      { key: "revenue", label: "Revenue", points: rv, max: maxOf(w.economics.revenue365), note: input.revenue365 > 0 ? `${usd(input.revenue365)} billed in 12 months` : "Nothing billed in 12 months" },
      { key: "margin", label: "Margin", points: mg, max: maxOf(w.economics.margin), note: input.margin === null ? "No job to measure margin on" : `${Math.round(input.margin * 100)}% projected margin` },
      { key: "daysToPay", label: "Days to pay", points: dp, max: maxOf(w.economics.daysToPay), note: input.daysToPay === null ? "No payment history" : `Pays in ${Math.round(input.daysToPay)} days on average` },
    ],
  };

  const sum = (s: { factors: HealthFactor[] }) => ({ ...s, points: s.factors.reduce((a, f) => a + f.points, 0), max: s.factors.reduce((a, f) => a + f.max, 0) });
  const breakdown = { engagement: sum(engagement), qualification: sum(qualification), bidFlow: sum(bidFlow), economics: sum(economics) };
  const raw = Math.round(Object.values(breakdown).reduce((a, s) => a + s.points, 0));
  const quietFor = touched ?? Math.floor((now.getTime() - at(input.createdAt)) / MS_DAY);
  const capped = quietFor >= w.dormantAfterDays && raw > w.dormantCap;
  const score = Math.max(0, Math.min(100, capped ? w.dormantCap : raw));
  const b = w.bands;
  const band: HealthBand = score >= b.strong ? "STRONG" : score >= b.active ? "ACTIVE" : score >= b.developing ? "DEVELOPING" : score >= b.cold ? "COLD" : "DORMANT";

  const strengths = (Object.keys(breakdown) as HealthSection[]).filter((k) => breakdown[k].max > 0 && breakdown[k].points / breakdown[k].max >= 0.7).map((k) => `${HEALTH_SECTION_LABEL[k]}: ${bestNote(breakdown[k].factors)}`);
  const weaknesses = Object.values(breakdown)
    .flatMap((s) => s.factors)
    .filter((f) => f.max > 0 && f.points / f.max < 0.5)
    .map((f) => f.note);
  if (capped) weaknesses.unshift(`No touch in ${quietFor} days — the score is held at ${w.dormantCap}`);

  // Recommended action: the first rule that matches.
  const who = input.primaryContactName ?? "the main contact";
  let recommendedAction: string;
  if (q?.status === "APPROVED" && expiresIn !== null && expiresIn < 0) recommendedAction = "Restart prequalification";
  else if (q?.status === "APPROVED" && expiresIn !== null && expiresIn <= w.expiringDays) recommendedAction = `Renew the prequalification before ${dayLabel(now.getTime() + expiresIn * MS_DAY)}`;
  else if (quietFor > w.quietDays) recommendedAction = `Call ${who}`;
  else if (input.invitations365 > 0 && input.submitted365 === 0) recommendedAction = "Bid the next one, or record why we pass";
  else if (input.daysToPay !== null && input.daysToPay > w.slowPayerDays) recommendedAction = "Raise payment terms before the next bid";
  else recommendedAction = `Keep the cadence — next touch by ${dayLabel((input.lastContactAt ? at(input.lastContactAt) : now.getTime()) + 30 * MS_DAY)}`;

  return { score, band, capped, breakdown, strengths, weaknesses, recommendedAction, weightsVersion };
}

function bestNote(factors: HealthFactor[]): string {
  return [...factors].sort((a, b) => b.points / (b.max || 1) - a.points / (a.max || 1))[0]?.note ?? "";
}
