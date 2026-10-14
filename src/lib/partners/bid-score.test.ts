import { describe, expect, it } from "vitest";
import { bidWeightsSchema, DEFAULT_BID_WEIGHTS, scoreBid, type BidScoreInput } from "./bid-score";

const base: BidScoreInput = {
  healthScore: 76,
  estimatedValue: 450_000,
  typicalRange: { min: 200_000, max: 1_000_000 },
  packageTradeIds: ["drywall", "framing"],
  ourTradeIds: ["drywall", "framing", "roofing"],
  county: "Hendry",
  homeCounties: ["Broward", "Palm Beach"],
  adjacentCounties: ["Hendry", "Miami-Dade"],
  daysToDue: 12,
  avgDaysToPay: 45,
  decidedSubmissions: 1,
  awards: 1,
  insuranceCurrent: true,
  bondRequired: false,
  bondingCapacity: null,
  manual: { margin: 4, capacity: 3, competition: 2, complexity: 3, plansAndTerms: 4 },
};

describe("scoreBid", () => {
  it("the worked example from the design scores 75 and recommends BID", () => {
    const r = scoreBid(base);
    // 11.4 + 10 + 10 + 6 + 5 + 7 + 3 + 0 + 8 + 6 + 2 + 3 + 4 = 75.4
    expect(r.score).toBe(75);
    expect(r.recommendation).toBe("BID");
    expect(r.weightsVersion).toBe(1);
    expect(r.reasons.length).toBeLessThanOrEqual(3);
    expect(r.concerns).toContain("Competition rated 2/5");
  });
  it("defaults validate", () => {
    expect(bidWeightsSchema.safeParse(DEFAULT_BID_WEIGHTS).success).toBe(true);
  });
  it("no trade fit is a hard NO_BID whatever the rest says", () => {
    const r = scoreBid({ ...base, packageTradeIds: ["electrical"] });
    expect(r.recommendation).toBe("NO_BID");
    expect(r.gates[0]).toMatch(/not ones KNU performs/);
  });
  it("a bond beyond capacity caps at REVIEW", () => {
    expect(scoreBid({ ...base, bondRequired: true, bondingCapacity: null }).recommendation).toBe("REVIEW");
    expect(scoreBid({ ...base, bondRequired: true, bondingCapacity: 300_000 }).recommendation).toBe("REVIEW");
    expect(scoreBid({ ...base, bondRequired: true, bondingCapacity: 2_000_000 }).recommendation).toBe("BID");
  });
  it("unknown inputs score their neutral and raise a concern, never throw", () => {
    const r = scoreBid({ ...base, healthScore: null, estimatedValue: null, county: null, daysToDue: null, avgDaysToPay: null, insuranceCurrent: null, manual: { margin: null, capacity: null, competition: null, complexity: null, plansAndTerms: null } });
    expect(r.breakdown.relationship.points).toBe(7.5);
    expect(r.breakdown.size.points).toBe(5);
    expect(r.breakdown.market.points).toBe(5);
    expect(r.breakdown.payment.points).toBe(5);
    expect(r.breakdown.margin.points).toBe(0);
    expect(r.concerns).toContain("Expected margin not rated");
    expect(r.concerns).toContain("No payment history with this GC yet");
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  it("lapsed insurance costs five points and a concern; slow payers and short lead times are concerns", () => {
    const r = scoreBid({ ...base, insuranceCurrent: false, avgDaysToPay: 75, daysToDue: 2 });
    expect(r.breakdown.insurance.points).toBe(-5);
    expect(r.concerns).toContain("Slow payer: 75 days on average");
    expect(r.concerns).toContain("Only 2 day(s) to bid");
  });
  it("win rate needs enough decided bids, then reads the rate", () => {
    expect(scoreBid({ ...base, decidedSubmissions: 2, awards: 0 }).breakdown.winRate.points).toBe(3);
    expect(scoreBid({ ...base, decidedSubmissions: 10, awards: 1 }).breakdown.winRate.points).toBe(1);
    expect(scoreBid({ ...base, decidedSubmissions: 10, awards: 5 }).breakdown.winRate.points).toBe(5);
  });
  it("honours edited weights and the version passed in", () => {
    const w = { ...DEFAULT_BID_WEIGHTS, bands: { bid: 90, review: 80 } };
    const r = scoreBid(base, w, 4);
    expect(r.recommendation).toBe("NO_BID");
    expect(r.weightsVersion).toBe(4);
  });
});
