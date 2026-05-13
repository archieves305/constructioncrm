import { describe, it, expect } from "vitest";
import { calculateEstimate } from "./calc";

const base = {
  materialCost: 0,
  materialSelection: null,
  permitFee: 0,
  dumpsterFee: 0,
  tearOffFee: 0,
  deckingFee: 0,
  underlaymentFee: 0,
  flashingVentFee: 0,
  skylightChimneyFee: 0,
  guttersFee: 0,
  miscLabel: null,
  miscFee: 0,
  marginPercent: 0,
  discountEnabled: false,
  discountPercent: 0,
  salesTaxPercent: 0,
};

describe("calculateEstimate", () => {
  it("single material: 10 squares × $400 + $500 permit + $300 dumpster, 0% margin", () => {
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 10, laborRatePerSquare: 400 },
      ],
      permitFee: 500,
      dumpsterFee: 300,
    });
    expect(r.laborTotal).toBe(4000);
    expect(r.otherFeesTotal).toBe(800);
    expect(r.subtotalCost).toBe(4800);
    expect(r.priceWithMargin).toBe(4800);
    expect(r.totalPrice).toBe(4800);
  });

  it("combo materials sum correctly", () => {
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 20, laborRatePerSquare: 400 },
        { material: "FLAT", squares: 5, laborRatePerSquare: 800 },
      ],
    });
    expect(r.totalSquares).toBe(25);
    expect(r.laborTotal).toBe(20 * 400 + 5 * 800); // 12000
    expect(r.subtotalCost).toBe(12000);
  });

  it("true margin: 20% margin on $10,000 cost = $12,500 price", () => {
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 25, laborRatePerSquare: 400 },
      ],
      marginPercent: 20,
    });
    expect(r.subtotalCost).toBe(10000);
    expect(r.priceWithMargin).toBe(12500);
    expect(r.marginAmount).toBe(2500);
    expect(r.totalPrice).toBe(12500);
  });

  it("discount applied AFTER margin, not before", () => {
    // cost 10k, +20% margin -> 12500, -10% discount -> 11250
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 25, laborRatePerSquare: 400 },
      ],
      marginPercent: 20,
      discountEnabled: true,
      discountPercent: 10,
    });
    expect(r.priceWithMargin).toBe(12500);
    expect(r.discountAmount).toBe(1250);
    expect(r.priceAfterDiscount).toBe(11250);
    expect(r.totalPrice).toBe(11250);
  });

  it("discountEnabled=false ignores the percent", () => {
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 25, laborRatePerSquare: 400 },
      ],
      marginPercent: 20,
      discountEnabled: false,
      discountPercent: 99, // should be ignored
    });
    expect(r.discountAmount).toBe(0);
    expect(r.totalPrice).toBe(12500);
  });

  it("sales tax applied AFTER discount", () => {
    // cost 10k -> +20% margin = 12500 -> -10% discount = 11250 -> +7% tax = 12037.50
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 25, laborRatePerSquare: 400 },
      ],
      marginPercent: 20,
      discountEnabled: true,
      discountPercent: 10,
      salesTaxPercent: 7,
    });
    expect(r.priceAfterDiscount).toBe(11250);
    expect(r.salesTaxAmount).toBe(787.5);
    expect(r.totalPrice).toBe(12037.5);
  });

  it("material cost is included in subtotal but separate from other fees", () => {
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "SHINGLE", squares: 20, laborRatePerSquare: 300 },
      ],
      materialCost: 4000,
      permitFee: 500,
    });
    expect(r.laborTotal).toBe(6000);
    expect(r.materialCost).toBe(4000);
    expect(r.otherFeesTotal).toBe(500); // permit only
    expect(r.subtotalCost).toBe(10500);
  });

  it("all optional fees are summed into other fees total", () => {
    const r = calculateEstimate({
      ...base,
      roofTypes: [
        { material: "METAL", squares: 1, laborRatePerSquare: 0 },
      ],
      permitFee: 100,
      dumpsterFee: 200,
      tearOffFee: 300,
      deckingFee: 400,
      underlaymentFee: 500,
      flashingVentFee: 600,
      skylightChimneyFee: 700,
      guttersFee: 800,
      miscFee: 900,
    });
    expect(r.otherFeesTotal).toBe(
      100 + 200 + 300 + 400 + 500 + 600 + 700 + 800 + 900,
    );
  });
});
