import { describe, expect, it } from "vitest";
import { computeCostSummary, type CostSummaryInput } from "./cost-summary";

const base: CostSummaryInput = {
  jobType: "FIXED_PRICE",
  revisedContract: 115_000,
  storedOriginalContract: 100_000,
  approvedChangeOrders: 15_000,
  approvedBillableAddOns: 0,
  budgetTotal: 72_000,
  estimateCost: null,
  laborContracts: 40_000,
  laborPaid: 36_000,
  fieldLaborUnposted: 5_000,
  expenses: 20_000,
  billedToDate: 90_000,
  collected: 80_000,
};

describe("computeCostSummary", () => {
  it("reproduces the owner's nine figures", () => {
    const s = computeCostSummary(base);
    expect(s.originalContract).toBe(100_000);
    expect(s.approvedChangeOrders).toBe(15_000);
    expect(s.revisedContract).toBe(115_000);
    expect(s.estimatedCost).toBe(72_000);
    expect(s.committed).toBe(65_000); // 36k labor paid + 5k field + 20k expenses + 4k labor still owed
    expect(s.spent).toBe(61_000);
    expect(s.remainingCost).toBe(11_000); // 72k − 61k
    expect(s.projectedProfit).toBe(43_000);
    expect(s.projectedMargin).toBeCloseTo(0.374, 3);
    expect(s.overBudget).toBe(false);
  });

  it("counts a labor contract when it is signed: the unpaid part is committed, not spent", () => {
    const s = computeCostSummary({ ...base, laborContracts: 40_000, laborPaid: 0 });
    expect(s.spent).toBe(25_000);
    expect(s.committedOpen).toBe(40_000);
    expect(s.committed).toBe(65_000);
  });

  it("never shows a negative commitment when labor was overpaid", () => {
    const s = computeCostSummary({ ...base, laborContracts: 10_000, laborPaid: 12_000 });
    expect(s.committedOpen).toBe(0);
    expect(s.spent).toBe(37_000);
  });

  it("projects from commitments once they pass the budget, and flags it", () => {
    const s = computeCostSummary({ ...base, budgetTotal: 50_000 });
    expect(s.overBudget).toBe(true);
    expect(s.projectedCost).toBe(65_000);
    expect(s.projectedProfit).toBe(50_000);
    expect(s.remainingCost).toBe(4_000);
  });

  it("with no budget falls back to the signed estimate's cost, then to cost to date", () => {
    const fromEstimate = computeCostSummary({ ...base, budgetTotal: null, estimateCost: 70_000 });
    expect(fromEstimate.estimatedCostSource).toBe("estimate");
    expect(fromEstimate.projectedCost).toBe(70_000);

    const none = computeCostSummary({ ...base, budgetTotal: null, estimateCost: null });
    expect(none.estimatedCost).toBeNull();
    expect(none.projectedCost).toBe(65_000);
    expect(none.percentCostComplete).toBeNull();
    expect(none.overUnderBilled).toBeNull();
  });

  it("derives the original contract on a fixed-price job when none was stored", () => {
    const s = computeCostSummary({ ...base, storedOriginalContract: null, approvedBillableAddOns: 2_500 });
    expect(s.originalContract).toBe(97_500);
  });

  it("has no original contract on a cost-plus job and no contract figures on an owned rehab", () => {
    expect(computeCostSummary({ ...base, jobType: "COST_PLUS", storedOriginalContract: null }).originalContract).toBeNull();
    const rehab = computeCostSummary({ ...base, jobType: "OWNED_REHAB", storedOriginalContract: null });
    expect(rehab.billable).toBe(false);
    expect(rehab.projectedProfit).toBeNull();
    expect(rehab.projectedMargin).toBeNull();
    expect(rehab.overUnderBilled).toBeNull();
    expect(rehab.remainingCost).toBe(11_000);
  });

  it("measures billing against cost progress: positive is billed ahead of the work", () => {
    const s = computeCostSummary(base); // 65k of 72k committed = 90.3% → earned ≈ 103,819
    expect(s.percentCostComplete).toBeCloseTo(65 / 72, 5);
    expect(s.overUnderBilled).toBeCloseTo(90_000 - 115_000 * (65 / 72), 1);
    expect(computeCostSummary({ ...base, billedToDate: 115_000 }).overUnderBilled).toBeGreaterThan(0);
  });

  it("shows no profit at all when there is neither a budget nor a cost — not a 100% margin", () => {
    const s = computeCostSummary({ ...base, budgetTotal: null, estimateCost: null, laborContracts: 0, laborPaid: 0, fieldLaborUnposted: 0, expenses: 0 });
    expect(s.projectedProfit).toBeNull();
    expect(s.projectedMargin).toBeNull();
  });

  it("handles a zero contract and credits without NaN", () => {
    const s = computeCostSummary({ ...base, revisedContract: 0, storedOriginalContract: 0, approvedChangeOrders: 0, expenses: -500, budgetTotal: 0 });
    expect(s.projectedMargin).toBeNull();
    expect(Number.isNaN(s.projectedCost)).toBe(false);
  });
});
