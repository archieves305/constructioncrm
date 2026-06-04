import { z } from "zod";

// ─── Knock Score configuration ────────────────────────────────────────────────
// The full 0–100 scoring model lives here as a *data* structure so every band and
// point value is editable from Admin → Canvassing settings (stored as JSON on
// `canvassing_settings.scoring_config_json`). `DEFAULT_SCORING_CONFIG` mirrors the
// spec exactly and is the seed for new installs / a fallback when settings are
// missing. The scorer in `score.ts` consumes whatever config it's handed — it
// never hard-codes thresholds — so tuning the config re-scores instantly.
//
// Band selection is by ascending `max` threshold: pick the first band whose `max`
// is null (open-ended) or `>= value`. Keep bands ordered low→high with the
// open-ended band last; the Zod schema and `pickBand()` both rely on that order.

// A scoring band: points awarded when `min <= value <= max`. `max: null` means
// "and up" (open-ended). `min`/`max` are kept for display/editing; selection uses
// `max` (see pickBand in score.ts).
export const bandSchema = z.object({
  min: z.number(),
  max: z.number().nullable(),
  points: z.number(),
});
export type ScoreBand = z.infer<typeof bandSchema>;

export const scoringConfigSchema = z.object({
  // A. Roof Opportunity — 40 pts
  roof: z.object({
    maxPoints: z.number().default(40),
    ageBands: z.array(bandSchema),
    // Roof age unknown (no permit) but the home itself is 20+ years old.
    unknownAgeBuiltOver20Points: z.number(),
    // No roof permit on record and the home is 15+ years old.
    permitNoneBuilt15PlusBonus: z.number(),
    // A roof permit was pulled within the last 10 years (newer roof → subtract).
    permitWithin10YearsPenalty: z.number(),
    // A roof permit exists but is older than 15 years.
    permitOlderThan15YearsBonus: z.number(),
  }),
  // B. Financial / Ability to Buy — 25 pts (by equity %)
  financial: z.object({
    maxPoints: z.number().default(25),
    equityBands: z.array(bandSchema),
  }),
  // C. Conversion — 20 pts (occupancy + ownership duration)
  conversion: z.object({
    maxPoints: z.number().default(20),
    ownerOccupiedPoints: z.number(),
    absenteePoints: z.number(),
    // Occupancy could not be determined (common — Zylow rarely carries it).
    unknownOccupancyPoints: z.number(),
    ownershipBands: z.array(bandSchema),
  }),
  // D. Personalization — 15 pts
  personalization: z.object({
    maxPoints: z.number().default(15),
    ownerNamePoints: z.number(),
    roofTypePoints: z.number(),
    sufficientDetailPoints: z.number(),
  }),
  // Tier labels, evaluated highest `min` first.
  tiers: z.array(z.object({ min: z.number(), label: z.string() })),
  // Equity % at or above which financing talking points are surfaced.
  highEquityThreshold: z.number().default(60),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  roof: {
    maxPoints: 40,
    ageBands: [
      { min: 0, max: 10, points: 5 },
      { min: 11, max: 15, points: 15 },
      { min: 16, max: 20, points: 25 },
      { min: 21, max: null, points: 35 },
    ],
    // Roof age is only *inferred* from the home's age (no permit on record — the
    // common case, since the property API rarely carries permits). Kept well below
    // the permit-confirmed old-roof band (35) so an unconfirmed old home doesn't
    // auto-inflate to the top of the list.
    unknownAgeBuiltOver20Points: 15,
    // "No roof permit on record" is a data gap, not evidence of an old roof, when
    // the source almost never reports permits — so it carries no positive signal.
    permitNoneBuilt15PlusBonus: 0,
    permitWithin10YearsPenalty: 10,
    permitOlderThan15YearsBonus: 5,
  },
  financial: {
    maxPoints: 25,
    equityBands: [
      { min: 0, max: 20, points: 5 },
      { min: 21, max: 40, points: 10 },
      { min: 41, max: 60, points: 15 },
      { min: 61, max: 80, points: 20 },
      { min: 81, max: 100, points: 25 },
    ],
  },
  conversion: {
    maxPoints: 20,
    ownerOccupiedPoints: 10,
    absenteePoints: 2,
    unknownOccupancyPoints: 0,
    ownershipBands: [
      { min: 0, max: 3, points: 2 },
      { min: 4, max: 9, points: 5 },
      { min: 10, max: 19, points: 8 },
      { min: 20, max: null, points: 10 },
    ],
  },
  personalization: {
    maxPoints: 15,
    ownerNamePoints: 5,
    roofTypePoints: 5,
    sufficientDetailPoints: 5,
  },
  tiers: [
    { min: 85, label: "Excellent Door Knock" },
    { min: 70, label: "Strong Door Knock" },
    { min: 50, label: "Average Door Knock" },
    { min: 30, label: "Low Priority" },
    { min: 0, label: "Skip / Low Value" },
  ],
  highEquityThreshold: 60,
};

export const DEFAULT_OPENING_SCRIPT =
  "Hi [Owner Name], I’m [Canvasser Name] with NewCoast Roofing. We’re helping " +
  "homeowners in this neighborhood whose roofs are reaching the age where " +
  "insurance companies and storm season become a bigger concern. We’re offering " +
  "complimentary roof inspections this week — would mornings or afternoons work " +
  "better for a quick look?";

export const DEFAULT_COMPLIANCE_DISCLAIMER =
  "This data is for internal canvassing prioritization only. Property data may be " +
  "incomplete or inaccurate. Canvassers must not represent estimated roof age, " +
  "equity, financing eligibility, or insurance impact as verified facts unless " +
  "confirmed by proper documentation.";
