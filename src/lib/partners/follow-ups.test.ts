import { describe, expect, it } from "vitest";
import { followUpKey, liveFollowUpKeys, planFollowUps, type FollowUpInput } from "./follow-ups";

const t = { newTargetDays: 5, noResponseDays: 7, qualSubmittedDays: 14, prequalNoBidDays: 30, activeQuietDays: 60 };

// 2026-10-12 is a Monday; org added Monday 2026-10-05 → 5 working days later is Monday 2026-10-12.
const org = { id: "org1", name: "Moss", stage: "TARGET" as const, createdAt: new Date("2026-10-05T14:00:00Z"), lastContactAt: null };
const fresh: FollowUpInput = { org, lastInteraction: null, interactionCount: 0 };

const call = (over: Partial<NonNullable<FollowUpInput["lastInteraction"]>> = {}) => ({
  id: "i1",
  kind: "CALL" as const,
  direction: "OUTBOUND" as const,
  outcome: "NO_ANSWER" as const,
  occurredAt: new Date("2026-10-01T14:00:00Z"),
  contactName: "Ana Ruiz",
  ...over,
});

describe("new-target", () => {
  it("fires at the working-day threshold, not the day before", () => {
    expect(planFollowUps(fresh, "2026-10-09", t)).toEqual([]); // 4 working days
    const plan = planFollowUps(fresh, "2026-10-12", t); // 5
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ rule: "new-target", sourceKey: followUpKey("org1", "new-target", "2026-10-05", 1), priority: "HIGH", dueDay: "2026-10-12" });
    expect(plan[0]!.title).toBe("Moss: first contact overdue");
  });

  it("re-raises once per period and stops once anyone has reached out", () => {
    expect(planFollowUps(fresh, "2026-10-19", t)[0]!.sourceKey).toBe(followUpKey("org1", "new-target", "2026-10-05", 2)); // 10 working days
    expect(planFollowUps({ ...fresh, interactionCount: 1 }, "2026-10-19", t)).toEqual([]);
    expect(planFollowUps({ ...fresh, org: { ...org, stage: "CONTACTED" } }, "2026-10-19", t)).toEqual([]);
  });
});

describe("no-response", () => {
  const base: FollowUpInput = { org: { ...org, stage: "CONTACTED", lastContactAt: new Date("2026-10-01T14:00:00Z") }, lastInteraction: call(), interactionCount: 3 };

  it("waits the threshold after an unanswered outbound touch, keyed on that interaction", () => {
    expect(planFollowUps(base, "2026-10-07", t)).toEqual([]);
    const plan = planFollowUps(base, "2026-10-08", t);
    expect(plan.map((p) => p.rule)).toEqual(["no-response"]);
    expect(plan[0]!.sourceKey).toBe(followUpKey("org1", "no-response", "i1", 1));
    expect(plan[0]!.title).toBe("Moss: no reply to your call on Oct 1");
    expect(plan[0]!.description).toContain("with Ana Ruiz");
  });

  it("never plans after a reply, a conversation or an inbound touch", () => {
    expect(planFollowUps({ ...base, lastInteraction: call({ outcome: "SPOKE" }) }, "2026-10-20", t)).toEqual([]);
    expect(planFollowUps({ ...base, lastInteraction: call({ direction: "INBOUND", outcome: "REPLIED" }) }, "2026-10-20", t)).toEqual([]);
    expect(planFollowUps({ ...base, lastInteraction: call({ outcome: "MEETING_HELD", kind: "MEETING" }) }, "2026-10-20", t)).toEqual([]);
  });

  it("a newer outbound touch re-keys the rule", () => {
    const newer = { ...base, lastInteraction: call({ id: "i2", occurredAt: new Date("2026-10-10T14:00:00Z"), kind: "EMAIL", outcome: "SENT" }) };
    expect(planFollowUps(newer, "2026-10-15", t)).toEqual([]);
    expect(planFollowUps(newer, "2026-10-17", t)[0]!.sourceKey).toBe(followUpKey("org1", "no-response", "i2", 1));
  });
});

describe("quiet", () => {
  const active: FollowUpInput = { org: { ...org, stage: "ACTIVE", lastContactAt: new Date("2026-08-01T14:00:00Z") }, lastInteraction: call({ occurredAt: new Date("2026-08-01T14:00:00Z"), outcome: "SPOKE" }), interactionCount: 9 };

  it("fires after the quiet threshold on an active partner and counts from creation when never contacted", () => {
    expect(planFollowUps(active, "2026-09-29", t)).toEqual([]); // 59 days
    const plan = planFollowUps(active, "2026-09-30", t); // 60
    expect(plan.map((p) => p.rule)).toEqual(["quiet"]);
    expect(plan[0]!.sourceKey).toBe(followUpKey("org1", "quiet", "active", 1));
    expect(plan[0]!.title).toBe("Moss: quiet for 60 days — schedule a check-in");
    const never = { ...active, org: { ...active.org, lastContactAt: null, createdAt: new Date("2026-06-01T00:00:00Z") }, lastInteraction: null, interactionCount: 0 };
    expect(planFollowUps(never, "2026-08-01", t)[0]!.rule).toBe("quiet");
  });

  it("is silent on parked and written-off accounts", () => {
    expect(planFollowUps({ ...active, org: { ...active.org, stage: "DORMANT" } }, "2026-12-01", t)).toEqual([]);
    expect(planFollowUps({ ...active, org: { ...active.org, stage: "DO_NOT_PURSUE" } }, "2026-12-01", t)).toEqual([]);
  });
});

describe("qualification rules (Stage 2 inputs)", () => {
  const engaged = { ...org, stage: "ENGAGED" as const, lastContactAt: new Date("2026-10-10T14:00:00Z") };
  it("checks a submitted application after the threshold", () => {
    const input: FollowUpInput = { org: engaged, lastInteraction: call({ outcome: "SPOKE" }), interactionCount: 2, qualification: { status: "SUBMITTED", submittedAt: new Date("2026-09-20T14:00:00Z"), approvedAt: null } };
    expect(planFollowUps(input, "2026-10-03", t)).toEqual([]);
    expect(planFollowUps(input, "2026-10-04", t)[0]!.sourceKey).toBe(followUpKey("org1", "qual-submitted", "2026-09-20", 1));
  });
  it("asks about bids once a prequalified account has gone quiet on bid activity", () => {
    const input: FollowUpInput = { org: engaged, lastInteraction: call({ outcome: "SPOKE" }), interactionCount: 2, qualification: { status: "APPROVED", submittedAt: null, approvedAt: new Date("2026-08-01T14:00:00Z") }, lastBidActivityAt: new Date("2026-09-01T14:00:00Z") };
    expect(planFollowUps(input, "2026-09-30", t)).toEqual([]);
    expect(planFollowUps(input, "2026-10-01", t)[0]!.sourceKey).toBe(followUpKey("org1", "prequal-no-bids", "2026-09-01", 1));
    expect(planFollowUps({ ...input, org: { ...engaged, stage: "CONTACTED" } }, "2026-10-01", t)).toEqual([]);
  });
});

describe("liveFollowUpKeys", () => {
  it("is the set of what is planned today — empty for a satisfied account", () => {
    expect(liveFollowUpKeys({ ...fresh, interactionCount: 2, org: { ...org, stage: "CONTACTED" }, lastInteraction: call({ outcome: "SPOKE" }) }, "2026-12-01", t).size).toBe(0);
    expect([...liveFollowUpKeys(fresh, "2026-10-12", t)]).toEqual([followUpKey("org1", "new-target", "2026-10-05", 1)]);
  });
});
