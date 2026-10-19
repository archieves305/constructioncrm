import { describe, expect, it } from "vitest";
import { autoWonEstimate, preselectWonEstimate, pricingFromGeneric, pricingFromRoof } from "./job-from-estimate";

const estimate = {
  id: "e1",
  estimateNumber: "EST-7",
  marginPercent: 20,
  discountEnabled: false,
  discountPercent: 0,
  salesTaxPercent: 0,
  sections: [
    { title: "Walls", items: [{ description: "Hang board", unitType: "EACH" as const, quantity: 100, unitPrice: 2 }] },
    { title: "Extras", items: [{ id: "o1", description: "Paint", unitType: "EACH" as const, quantity: 1, unitPrice: 50, isOptional: true }] },
  ],
};

describe("pricingFromGeneric", () => {
  it("prices the estimate without its optional items and budgets each section at cost", () => {
    expect(pricingFromGeneric(estimate)).toEqual({ price: 250, cost: 200, budgetLines: [{ category: "Estimate EST-7", name: "Walls", amount: 200 }] });
  });
  it("counts an optional item the customer chose, in the price, the cost and its section's budget", () => {
    const p = pricingFromGeneric(estimate, new Set(["o1"]));
    expect(p.cost).toBe(250);
    expect(p.price).toBe(312.5);
    expect(p.budgetLines).toEqual([
      { category: "Estimate EST-7", name: "Walls", amount: 200 },
      { category: "Estimate EST-7", name: "Extras", amount: 50 },
    ]);
  });
});

describe("pricingFromRoof", () => {
  it("takes the roofing estimate's total and cost, budgeted as one line", () => {
    expect(pricingFromRoof({ id: "r", estimateNumber: "RE-3", subtotalCost: 9000, totalPrice: 14000 })).toEqual({
      price: 14000,
      cost: 9000,
      budgetLines: [{ category: "Estimate RE-3", name: "Roofing", amount: 9000 }],
    });
  });
});

describe("which estimate a Won uses", () => {
  const opts = [
    { kind: "GENERIC" as const, id: "draft", status: "DRAFT", updatedAt: "2026-10-03" },
    { kind: "GENERIC" as const, id: "sent-old", status: "SENT", updatedAt: "2026-10-01" },
    { kind: "GENERIC" as const, id: "sent-new", status: "SENT", updatedAt: "2026-10-05" },
    { kind: "ROOF" as const, id: "roof", status: null, updatedAt: "2026-10-09" },
  ];
  it("the dialog preselects the accepted one, else the latest sent, never a roofing estimate", () => {
    expect(preselectWonEstimate(opts)).toEqual({ kind: "GENERIC", id: "sent-new" });
    expect(preselectWonEstimate([...opts, { kind: "GENERIC", id: "acc", status: "ACCEPTED", updatedAt: "2026-09-01" }])).toEqual({ kind: "GENERIC", id: "acc" });
    expect(preselectWonEstimate([opts[3]])).toBeNull();
  });
  it("a Won without the dialog uses an estimate only when exactly one is accepted", () => {
    expect(autoWonEstimate(opts)).toBeNull();
    const one = [...opts, { kind: "GENERIC" as const, id: "acc", status: "ACCEPTED", updatedAt: "2026-09-01" }];
    expect(autoWonEstimate(one)).toEqual({ kind: "GENERIC", id: "acc" });
    expect(autoWonEstimate([...one, { kind: "GENERIC" as const, id: "acc2", status: "ACCEPTED", updatedAt: "2026-09-02" }])).toBeNull();
  });
});
