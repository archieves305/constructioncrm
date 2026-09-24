import { describe, expect, it } from "vitest";
import { escalationAudience, parseThresholds, planEscalations } from "./escalations";

const today = new Date(2026, 8, 24); // local midnight
const daysAgo = (n: number) => new Date(2026, 8, 24 - n, 15, 0);

describe("parseThresholds", () => {
  it("parses, sorts and dedupes", () => {
    expect(parseThresholds("5,2,2")).toEqual([2, 5]);
  });
  it("ignores zeros and junk", () => {
    expect(parseThresholds("0,x,3")).toEqual([3]);
  });
});

describe("planEscalations", () => {
  const th = [2, 5];
  it("does nothing one day overdue", () => {
    expect(planEscalations([{ id: "a", dueAt: daysAgo(1), escalationLevel: 0 }], th, today)).toEqual([]);
  });
  it("reaches level 1 at two days", () => {
    expect(planEscalations([{ id: "a", dueAt: daysAgo(2), escalationLevel: 0 }], th, today)).toEqual([
      { taskId: "a", fromLevel: 0, toLevel: 1, daysOverdue: 2 },
    ]);
  });
  it("jumps straight to level 2 in one plan when the cron was off", () => {
    expect(planEscalations([{ id: "a", dueAt: daysAgo(7), escalationLevel: 0 }], th, today)).toEqual([
      { taskId: "a", fromLevel: 0, toLevel: 2, daysOverdue: 7 },
    ]);
  });
  it("is silent once the level is already reached", () => {
    expect(planEscalations([{ id: "a", dueAt: daysAgo(9), escalationLevel: 2 }], th, today)).toEqual([]);
  });
  it("skips tasks due today or without a date", () => {
    expect(
      planEscalations(
        [
          { id: "a", dueAt: new Date(2026, 8, 24, 9), escalationLevel: 0 },
          { id: "b", dueAt: null, escalationLevel: 0 },
        ],
        th,
        today,
      ),
    ).toEqual([]);
  });
});

describe("escalationAudience", () => {
  const managers = [
    { userId: "m1", reason: "manager" as const },
    { userId: "m2", reason: "manager" as const },
  ];
  const plan1 = { taskId: "t", fromLevel: 0, toLevel: 1, daysOverdue: 2 };
  const plan2 = { ...plan1, toLevel: 2, daysOverdue: 6 };

  it("level 1 goes to the assignor only", () => {
    expect(escalationAudience(plan1, { assignedUserId: "a", createdByUserId: "c" }, managers)).toEqual([
      { userId: "c", reason: "assignor" },
    ]);
  });
  it("skips an assignor who is also the assignee — the digest already nags them", () => {
    expect(escalationAudience(plan1, { assignedUserId: "c", createdByUserId: "c" }, managers)).toEqual([]);
  });
  it("level 2 adds the managers, minus the assignee", () => {
    expect(escalationAudience(plan2, { assignedUserId: "m2", createdByUserId: "c" }, managers)).toEqual([
      { userId: "c", reason: "assignor" },
      { userId: "m1", reason: "manager" },
    ]);
  });
});
