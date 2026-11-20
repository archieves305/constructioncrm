import { describe, expect, it } from "vitest";
import { computeOwnedReturns, type OwnedReturnsInput } from "./owned-returns";

const flip: OwnedReturnsInput = {
  purpose: "FLIP",
  purchasePrice: 250_000,
  afterRepairValue: 420_000,
  salePrice: null,
  monthlyRent: null,
  projectedCost: 60_000,
  committed: 35_000,
};

describe("computeOwnedReturns", () => {
  it("a flip: all-in is price plus projected rehab, profit is ARV less that", () => {
    const r = computeOwnedReturns(flip);
    expect(r.allIn).toBe(310_000);
    expect(r.investedSoFar).toBe(285_000);
    expect(r.expectedProfit).toBe(110_000);
    expect(r.expectedMargin).toBeCloseTo(0.2619, 4);
    expect(r.actualProfit).toBeNull();
    expect(r.grossYield).toBeNull();
  });

  it("a sold flip shows the profit it made", () => {
    expect(computeOwnedReturns({ ...flip, salePrice: 400_000 }).actualProfit).toBe(90_000);
  });

  it("guesses nothing without a purchase price or an ARV", () => {
    const r = computeOwnedReturns({ ...flip, purchasePrice: null });
    expect(r.allIn).toBeNull();
    expect(r.expectedProfit).toBeNull();
    expect(computeOwnedReturns({ ...flip, afterRepairValue: null }).expectedProfit).toBeNull();
  });

  it("a rental: a year's rent against all-in", () => {
    const r = computeOwnedReturns({ ...flip, purpose: "RENTAL", afterRepairValue: null, monthlyRent: 2_500 });
    expect(r.annualRent).toBe(30_000);
    expect(r.grossYield).toBeCloseTo(30_000 / 310_000, 6);
    expect(r.expectedProfit).toBeNull();
    expect(computeOwnedReturns({ ...flip, purpose: "RENTAL", monthlyRent: null }).grossYield).toBeNull();
  });

  it("an owned job with no purpose reads as a flip", () => {
    expect(computeOwnedReturns({ ...flip, purpose: null }).purpose).toBe("FLIP");
  });
});
