import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_WEIGHTS, healthWeightsSchema, scoreHealth, type HealthInput } from "./health";

const now = new Date("2026-10-13T16:00:00.000Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000);

// The plan's worked example (§17): Coastal Choice with plausible values.
const coastal: HealthInput = {
  lastContactAt: daysAgo(20),
  createdAt: daysAgo(400),
  meetings365: 1,
  interactions90: 3,
  qualification: { status: "APPROVED", expiresAt: daysAhead(200) },
  invitations365: 1,
  submitted365: 1,
  awards365: 1,
  revenue365: 300_000,
  margin: 0.25,
  daysToPay: 45,
  primaryContactName: "Dana Reyes",
};

describe("scoreHealth", () => {
  it("the worked example scores 76, Active, with 'one invitation' as a weakness", () => {
    const r = scoreHealth(coastal, DEFAULT_HEALTH_WEIGHTS, 1, now);
    expect(r.breakdown.engagement.points).toBe(21);
    expect(r.breakdown.qualification.points).toBe(20);
    expect(r.breakdown.bidFlow.points).toBe(15);
    expect(r.breakdown.economics.points).toBe(20);
    expect(r.score).toBe(76);
    expect(r.band).toBe("ACTIVE");
    expect(r.weaknesses).toContain("One invitation in 12 months");
    expect(r.recommendedAction).toMatch(/^Keep the cadence/);
    expect(r.strengths.length).toBeGreaterThan(0);
  });
  it("section maxima add to 100", () => {
    const r = scoreHealth(coastal, DEFAULT_HEALTH_WEIGHTS, 1, now);
    expect(Object.values(r.breakdown).reduce((a, s) => a + s.max, 0)).toBe(100);
  });
  it("200 days untouched caps at 40 and says to call the contact", () => {
    const r = scoreHealth({ ...coastal, lastContactAt: daysAgo(200), interactions90: 0, meetings365: 0 }, DEFAULT_HEALTH_WEIGHTS, 1, now);
    expect(r.capped).toBe(true);
    expect(r.score).toBe(40);
    expect(r.band).toBe("DEVELOPING");
    expect(r.recommendedAction).toBe("Call Dana Reyes");
    expect(r.weaknesses[0]).toMatch(/No touch in 200 days/);
  });
  it("a never-contacted account old enough to be dormant is capped too", () => {
    const r = scoreHealth({ ...coastal, lastContactAt: null, createdAt: daysAgo(181) }, DEFAULT_HEALTH_WEIGHTS, 1, now);
    expect(r.capped).toBe(true);
  });
  it("band boundaries", () => {
    const zero: HealthInput = { lastContactAt: null, createdAt: daysAgo(1), meetings365: 0, interactions90: 0, qualification: null, invitations365: 0, submitted365: 0, awards365: 0, revenue365: 0, margin: null, daysToPay: null, primaryContactName: null };
    expect(scoreHealth(zero, DEFAULT_HEALTH_WEIGHTS, 1, now)).toMatchObject({ score: 0, band: "DORMANT" });
    const w = { ...DEFAULT_HEALTH_WEIGHTS, qualification: { ...DEFAULT_HEALTH_WEIGHTS.qualification, none: 20 } };
    expect(scoreHealth(zero, w, 1, now)).toMatchObject({ score: 20, band: "COLD" });
    expect(scoreHealth({ ...zero, lastContactAt: daysAgo(1), qualification: { status: "APPROVED", expiresAt: null } }, DEFAULT_HEALTH_WEIGHTS, 1, now)).toMatchObject({ score: 35, band: "COLD" });
    expect(scoreHealth({ ...coastal, invitations365: 4, submitted365: 3, awards365: 2, revenue365: 600_000, daysToPay: 20, meetings365: 2, interactions90: 5, lastContactAt: daysAgo(3) }, DEFAULT_HEALTH_WEIGHTS, 1, now)).toMatchObject({ score: 100, band: "STRONG" });
  });
  it("null economics score nothing and say why", () => {
    const r = scoreHealth({ ...coastal, revenue365: 0, margin: null, daysToPay: null }, DEFAULT_HEALTH_WEIGHTS, 1, now);
    expect(r.breakdown.economics.points).toBe(0);
    expect(r.weaknesses).toEqual(expect.arrayContaining(["Nothing billed in 12 months", "No job to measure margin on", "No payment history"]));
  });
  it("qualification states", () => {
    const s = (qualification: HealthInput["qualification"]) => scoreHealth({ ...coastal, qualification }, DEFAULT_HEALTH_WEIGHTS, 1, now).breakdown.qualification.points;
    expect(s({ status: "APPROVED", expiresAt: daysAhead(60) })).toBe(14);
    expect(s({ status: "APPROVED", expiresAt: daysAgo(1) })).toBe(2);
    expect(s({ status: "SUBMITTED", expiresAt: null })).toBe(10);
    expect(s({ status: "INFO_REQUESTED", expiresAt: null })).toBe(10);
    expect(s({ status: "IN_PROGRESS", expiresAt: null })).toBe(5);
    expect(s({ status: "REJECTED", expiresAt: null })).toBe(0);
    expect(s(null)).toBe(0);
  });
  it("action table order: expired prequal, expiring, quiet, unbid invitations, slow payer", () => {
    const a = (over: Partial<HealthInput>) => scoreHealth({ ...coastal, ...over }, DEFAULT_HEALTH_WEIGHTS, 1, now).recommendedAction;
    expect(a({ qualification: { status: "APPROVED", expiresAt: daysAgo(3) }, lastContactAt: daysAgo(100) })).toBe("Restart prequalification");
    expect(a({ qualification: { status: "APPROVED", expiresAt: daysAhead(30) } })).toMatch(/^Renew the prequalification before/);
    expect(a({ lastContactAt: daysAgo(70) })).toBe("Call Dana Reyes");
    expect(a({ submitted365: 0 })).toBe("Bid the next one, or record why we pass");
    expect(a({ daysToPay: 75 })).toBe("Raise payment terms before the next bid");
    expect(a({ primaryContactName: null, lastContactAt: daysAgo(70) })).toBe("Call the main contact");
  });
  it("submit ratio bonus needs half the invitations submitted", () => {
    expect(scoreHealth({ ...coastal, invitations365: 4, submitted365: 1 }, DEFAULT_HEALTH_WEIGHTS, 1, now).breakdown.bidFlow.factors[1]!.points).toBe(0);
    expect(scoreHealth({ ...coastal, invitations365: 4, submitted365: 2 }, DEFAULT_HEALTH_WEIGHTS, 1, now).breakdown.bidFlow.factors[1]!.points).toBe(4);
  });
  it("honours edited weights and reports their version", () => {
    const w = { ...DEFAULT_HEALTH_WEIGHTS, dormantCap: 25 };
    const r = scoreHealth({ ...coastal, lastContactAt: daysAgo(200) }, w, 3, now);
    expect(r.score).toBe(25);
    expect(r.weightsVersion).toBe(3);
  });
  it("defaults validate; a malformed config does not", () => {
    expect(healthWeightsSchema.safeParse(DEFAULT_HEALTH_WEIGHTS).success).toBe(true);
    expect(healthWeightsSchema.safeParse({ ...DEFAULT_HEALTH_WEIGHTS, bands: { strong: "x" } }).success).toBe(false);
  });
});
