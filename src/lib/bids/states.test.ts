import { describe, expect, it } from "vitest";
import { bidProjectNumber, canMovePrime, canMoveProject, canMoveScope, derivedProjectStage, isConfirmedAward, opportunityOutcome, projectAddressKey, projectNameKey, projectStageNeeds, scopeStatusForAward } from "./states";

describe("opportunityOutcome", () => {
  it("stays open while any scope is undecided", () => {
    expect(opportunityOutcome([{ status: "AWARDED" }, { status: "PENDING" }])).toEqual({ closed: false });
    expect(opportunityOutcome([{ status: "VERBAL" }])).toEqual({ closed: false });
    expect(opportunityOutcome([])).toEqual({ closed: false });
  });
  it("is AWARDED when any scope was won, even with others lost (a partial award)", () => {
    expect(opportunityOutcome([{ status: "EXECUTED" }, { status: "LOST", lossReason: "PRICE" }])).toEqual({ closed: true, outcome: "AWARDED", lossReason: null });
  });
  it("carries the one loss reason, or OTHER for mixed reasons", () => {
    expect(opportunityOutcome([{ status: "LOST", lossReason: "GC_LOST_PRIME" }, { status: "LOST", lossReason: "GC_LOST_PRIME" }])).toEqual({ closed: true, outcome: "LOST", lossReason: "GC_LOST_PRIME" });
    expect(opportunityOutcome([{ status: "LOST", lossReason: "PRICE" }, { status: "WITHDRAWN" }])).toMatchObject({ outcome: "LOST", lossReason: "OTHER" });
    expect(opportunityOutcome([{ status: "WITHDRAWN" }])).toMatchObject({ outcome: "LOST", lossReason: "WITHDRAWN" });
  });
  it("reads all-NO_BID as passed and anything else as cancelled", () => {
    expect(opportunityOutcome([{ status: "NO_BID" }])).toMatchObject({ outcome: "NO_BID" });
    expect(opportunityOutcome([{ status: "CANCELLED" }, { status: "NO_BID" }])).toMatchObject({ outcome: "CANCELLED" });
  });
});

describe("derivedProjectStage", () => {
  it("one GC losing the prime leaves the project open while another is bidding", () => {
    expect(derivedProjectStage("OPEN", [{ closed: true, primeStatus: "GC_LOST" }, { closed: false, primeStatus: "PENDING" }])).toBe("OPEN");
  });
  it("is PRIME_AWARDED once a GC holds the job, CLOSED once every GC is decided", () => {
    expect(derivedProjectStage("OPEN", [{ closed: false, primeStatus: "GC_AWARDED" }, { closed: true, primeStatus: "GC_LOST" }])).toBe("PRIME_AWARDED");
    expect(derivedProjectStage("PRIME_AWARDED", [{ closed: true, primeStatus: "GC_AWARDED" }])).toBe("CLOSED");
  });
  it("never overrides a hand-set stage", () => {
    expect(derivedProjectStage("POSTPONED", [{ closed: true, primeStatus: "GC_LOST" }])).toBe("POSTPONED");
    expect(derivedProjectStage("CANCELLED", [])).toBe("CANCELLED");
  });
  it("a project with no GCs yet is open", () => {
    expect(derivedProjectStage("OPEN", [])).toBe("OPEN");
  });
});

describe("transitions", () => {
  it("a signed subcontract is final; a loss can be reopened", () => {
    expect(canMoveScope("EXECUTED", "PENDING")).toBe(false);
    expect(canMoveScope("LOST", "PENDING")).toBe(true);
    expect(canMoveScope("VERBAL", "EXECUTED")).toBe(true);
    expect(canMoveScope("AWARDED", "LOST")).toBe(false);
  });
  it("prime and project moves", () => {
    expect(canMovePrime("GC_LOST", "GC_AWARDED")).toBe(true);
    expect(canMovePrime("GC_AWARDED", "UNKNOWN")).toBe(false);
    expect(canMoveProject("CANCELLED", "POSTPONED")).toBe(false);
    expect(canMoveProject("CANCELLED", "OPEN")).toBe(true);
    expect(projectStageNeeds("POSTPONED")).toEqual({ reason: true, reviewAt: true });
    expect(projectStageNeeds("OPEN")).toEqual({ reason: false, reviewAt: false });
  });
  it("only written and signed awards are confirmed", () => {
    expect(isConfirmedAward("VERBAL")).toBe(false);
    expect(isConfirmedAward("WRITTEN")).toBe(true);
    expect(scopeStatusForAward("EXECUTED")).toBe("EXECUTED");
  });
});

describe("keys", () => {
  it("matches the same street written two ways", () => {
    expect(projectAddressKey("3310 NE 37th Street", "33308-1234")).toBe(projectAddressKey("3310 NE 37th St.", "33308"));
  });
  it("refuses a street with no number", () => {
    expect(projectAddressKey("Main Street", "33308")).toBeNull();
  });
  it("names and numbers", () => {
    expect(projectNameKey("  Palm Beach — Phase 2!")).toBe("palm beach phase 2");
    expect(bidProjectNumber(7)).toBe("BP-00007");
  });
});
