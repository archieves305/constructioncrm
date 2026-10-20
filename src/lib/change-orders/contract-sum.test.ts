import { describe, expect, it } from "vitest";
import { changeOrderContractSum } from "./contract-sum";

const base = {
  jobType: "FIXED_PRICE",
  contractAmount: 51_500,
  originalContractAmount: null,
  approved: [
    { number: 1, customerPrice: 1_000 },
    { number: 3, customerPrice: 500 },
  ],
};

describe("changeOrderContractSum", () => {
  it("derives the original sum from the current one when no contract recorded it", () => {
    expect(changeOrderContractSum({ ...base, thisNumber: 2, thisPrice: 250 })).toEqual({
      original: 50_000,
      previousChanges: 1_000,
      beforeThis: 51_000,
      revised: 51_250,
    });
  });

  it("counts only earlier approved changes, this one included when approved", () => {
    expect(changeOrderContractSum({ ...base, thisNumber: 3, thisPrice: 500 })).toEqual({
      original: 50_000,
      previousChanges: 1_000,
      beforeThis: 51_000,
      revised: 51_500,
    });
  });

  it("prefers the signed original and handles a credit", () => {
    expect(
      changeOrderContractSum({ ...base, originalContractAmount: 49_000, thisNumber: 4, thisPrice: -300 }),
    ).toEqual({ original: 49_000, previousChanges: 1_500, beforeThis: 50_500, revised: 50_200 });
  });

  it("is null for rollup jobs and jobs with no contract sum", () => {
    expect(changeOrderContractSum({ ...base, jobType: "COST_PLUS", thisNumber: 2, thisPrice: 1 })).toBeNull();
    expect(
      changeOrderContractSum({ ...base, contractAmount: 0, approved: [], thisNumber: 1, thisPrice: 1 }),
    ).toBeNull();
  });
});
