import { describe, expect, it } from "vitest";
import { canMoveStatus, commitmentCode, commitmentForExpense, openAmount, receivedAmount } from "./commitments";
import { computeCostSummary, type CostSummaryInput } from "@/lib/jobs/cost-summary";

describe("openAmount", () => {
  it("is the amount less what approved expenses have drawn, never below zero", () => {
    expect(openAmount({ status: "OPEN", amount: 10_000 }, 0)).toBe(10_000);
    expect(openAmount({ status: "OPEN", amount: 10_000 }, 4_000)).toBe(6_000);
    expect(openAmount({ status: "OPEN", amount: 10_000 }, 12_500)).toBe(0);
  });

  it("is nothing once the commitment is closed or cancelled", () => {
    expect(openAmount({ status: "CLOSED", amount: 10_000 }, 4_000)).toBe(0);
    expect(openAmount({ status: "CANCELLED", amount: 10_000 }, 0)).toBe(0);
  });
});

describe("receivedAmount", () => {
  it("counts only approved expenses; a credit gives money back", () => {
    expect(
      receivedAmount([
        { amount: 4_000, status: "APPROVED" },
        { amount: 900, status: "PENDING" },
        { amount: 500, status: "REJECTED" },
        { amount: -250.5, status: "APPROVED" },
      ]),
    ).toBe(3_749.5);
  });
});

describe("commitmentForExpense", () => {
  const open = [
    { id: "c1", vendorId: "banner" },
    { id: "c2", vendorId: "depot" },
    { id: "c3", vendorId: "depot" },
  ];
  it("links when the vendor has exactly one open commitment on the job", () => {
    expect(commitmentForExpense("banner", open)).toBe("c1");
  });
  it("leaves it to a person when there are two, none, or no vendor", () => {
    expect(commitmentForExpense("depot", open)).toBeNull();
    expect(commitmentForExpense("lowes", open)).toBeNull();
    expect(commitmentForExpense(null, open)).toBeNull();
  });
});

describe("status moves and codes", () => {
  it("anything may be reopened; a cancelled commitment is not closed", () => {
    expect(canMoveStatus("OPEN", "CLOSED")).toBe(true);
    expect(canMoveStatus("CLOSED", "OPEN")).toBe(true);
    expect(canMoveStatus("CANCELLED", "OPEN")).toBe(true);
    expect(canMoveStatus("CANCELLED", "CLOSED")).toBe(false);
  });
  it("is shown as C-n", () => expect(commitmentCode(3)).toBe("C-3"));
});

describe("commitments in the job cost summary", () => {
  const base: CostSummaryInput = {
    jobType: "FIXED_PRICE",
    revisedContract: 100_000,
    storedOriginalContract: 100_000,
    approvedChangeOrders: 0,
    approvedBillableAddOns: 0,
    budgetTotal: null,
    estimateCost: null,
    laborContracts: 30_000,
    laborPaid: 10_000,
    fieldLaborUnposted: 0,
    expenses: 5_000,
    commitmentsOpen: 0,
    billedToDate: 0,
    collected: 0,
  };

  it("a $10,000 commitment raises committed by $10,000 and lowers projected profit by the same", () => {
    const before = computeCostSummary(base);
    const after = computeCostSummary({ ...base, commitmentsOpen: 10_000 });
    expect(after.committed - before.committed).toBe(10_000);
    expect((before.projectedProfit as number) - (after.projectedProfit as number)).toBe(10_000);
    expect(after.spent).toBe(before.spent);
    expect(after).toMatchObject({ laborCommittedOpen: 20_000, commitmentsOpen: 10_000, committedOpen: 30_000 });
  });

  it("an expense against it moves money from committed to spent; the total does not change", () => {
    const promised = computeCostSummary({ ...base, commitmentsOpen: 10_000 });
    const partPaid = computeCostSummary({ ...base, commitmentsOpen: 6_000, expenses: 9_000 });
    expect(partPaid.spent - promised.spent).toBe(4_000);
    expect(partPaid.committed).toBe(promised.committed);
    expect(partPaid.projectedProfit).toBe(promised.projectedProfit);
  });

  it("under a budget, a commitment changes the projection only once it passes the budget", () => {
    const withBudget = { ...base, budgetTotal: 60_000 };
    expect(computeCostSummary({ ...withBudget, commitmentsOpen: 10_000 }).projectedCost).toBe(60_000);
    const over = computeCostSummary({ ...withBudget, commitmentsOpen: 40_000 });
    expect(over.projectedCost).toBe(75_000);
    expect(over.overBudget).toBe(true);
  });
});
