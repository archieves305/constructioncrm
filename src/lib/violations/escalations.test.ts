import { describe, expect, it } from "vitest";
import { caseEscalationAudience, parseEscalationDays, planCaseEscalations, type EscalationCase } from "./escalations";

const now = new Date("2026-10-10T13:00:00Z");
const c = (over: Partial<EscalationCase> = {}): EscalationCase => ({ id: "c1", caseNumber: "CV-00001", leadId: "l1", caseManagerId: "cm", currentDeadline: new Date("2026-10-05T17:00:00Z"), currentLevel: 0, ...over });

describe("planCaseEscalations", () => {
  it("parses thresholds sorted and deduped", () => {
    expect(parseEscalationDays("7,1,3,3,0,x")).toEqual([1, 3, 7]);
  });
  it("escalates to the count of thresholds passed, once, and never for a future deadline", () => {
    const plans = planCaseEscalations([c(), c({ id: "c2", currentLevel: 2 }), c({ id: "c3", currentDeadline: new Date("2026-10-12T17:00:00Z") })], [1, 3, 7], now);
    expect(plans).toEqual([{ caseId: "c1", fromLevel: 0, toLevel: 2, daysOverdue: 5 }]);
  });
  it("jumps straight to the highest crossed level after a gap", () => {
    expect(planCaseEscalations([c({ currentDeadline: new Date("2026-09-01T17:00:00Z") })], [1, 3, 7], now)[0]).toMatchObject({ toLevel: 3, daysOverdue: 39 });
  });
});

describe("caseEscalationAudience", () => {
  const plan = (toLevel: number) => ({ caseId: "c1", fromLevel: 0, toLevel, daysOverdue: 9 });
  it("level 1 is the case manager alone; 2 adds managers; 3 adds admins; nobody twice", () => {
    expect(caseEscalationAudience(plan(1), { caseManagerId: "cm" }, ["m1", "cm"], ["a1"]).map((x) => x.userId)).toEqual(["cm"]);
    expect(caseEscalationAudience(plan(2), { caseManagerId: "cm" }, ["m1", "cm"], ["a1"]).map((x) => [x.userId, x.reason])).toEqual([["cm", "case_manager"], ["m1", "manager"]]);
    expect(caseEscalationAudience(plan(3), { caseManagerId: "cm" }, ["m1"], ["a1", "m1"]).map((x) => x.userId)).toEqual(["cm", "m1", "a1"]);
  });
  it("with no case manager the managers hear level 1", () => {
    expect(caseEscalationAudience(plan(1), { caseManagerId: null }, ["m1"], ["a1"]).map((x) => x.userId)).toEqual(["m1"]);
  });
});
