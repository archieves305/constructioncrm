/**
 * What one of our own projects is worth to us (Richard, 2026-11-20). Pure.
 *
 * All-in is the property's price plus what the rehab will cost — the
 * projected cost from the one cost calculation (the budget, or what is
 * already spent and promised once that passes it). A flip measures that
 * against what it should sell for (ARV) and, once sold, what it did sell
 * for; a rental against a year's rent. Nothing is guessed: a figure that
 * needs a missing input is null.
 */
export type OwnedReturnsInput = {
  purpose: "FLIP" | "RENTAL" | null;
  purchasePrice: number | null;
  afterRepairValue: number | null;
  salePrice: number | null;
  monthlyRent: number | null;
  /** From computeCostSummary: the budget, or spent + promised once they pass it. */
  projectedCost: number;
  /** From computeCostSummary: spent + promised so far. */
  committed: number;
};

export type OwnedReturns = {
  purpose: "FLIP" | "RENTAL";
  /** Purchase price + projected rehab cost; null until the purchase price is on file. */
  allIn: number | null;
  /** Purchase price + spent and promised so far. */
  investedSoFar: number | null;
  /** Flip: ARV − all-in. */
  expectedProfit: number | null;
  /** Flip: expected profit ÷ ARV. */
  expectedMargin: number | null;
  /** Flip, once sold: sale price − all-in. */
  actualProfit: number | null;
  /** Rental: rent × 12 ÷ all-in (gross, before expenses). */
  grossYield: number | null;
  annualRent: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

export function computeOwnedReturns(i: OwnedReturnsInput): OwnedReturns {
  const purpose = i.purpose === "RENTAL" ? "RENTAL" : "FLIP";
  const hasPurchase = i.purchasePrice !== null && Number.isFinite(i.purchasePrice) && i.purchasePrice >= 0;
  const allIn = hasPurchase ? round2(i.purchasePrice! + i.projectedCost) : null;
  const investedSoFar = hasPurchase ? round2(i.purchasePrice! + i.committed) : null;

  if (purpose === "RENTAL") {
    const annualRent = positive(i.monthlyRent) ? round2(i.monthlyRent * 12) : null;
    return {
      purpose,
      allIn,
      investedSoFar,
      expectedProfit: null,
      expectedMargin: null,
      actualProfit: null,
      annualRent,
      grossYield: annualRent !== null && allIn !== null && allIn > 0 ? annualRent / allIn : null,
    };
  }
  const expectedProfit = positive(i.afterRepairValue) && allIn !== null ? round2(i.afterRepairValue - allIn) : null;
  return {
    purpose,
    allIn,
    investedSoFar,
    expectedProfit,
    expectedMargin: expectedProfit !== null && positive(i.afterRepairValue) ? expectedProfit / i.afterRepairValue : null,
    actualProfit: positive(i.salePrice) && allIn !== null ? round2(i.salePrice - allIn) : null,
    annualRent: null,
    grossYield: null,
  };
}
