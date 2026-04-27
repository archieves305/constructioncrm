import { describe, it, expect } from "vitest";
import { computeCostPlusContract } from "./job-pricing";

describe("computeCostPlusContract", () => {
  describe("PERCENT margin", () => {
    it("adds margin as percentage of (labor + expenses)", () => {
      const result = computeCostPlusContract({
        laborCost: 1000,
        expensesTotal: 500,
        marginType: "PERCENT",
        marginValue: 20,
      });
      expect(result.contract).toBe(1800);
      expect(result.margin).toBe(300);
    });

    it("returns zero margin when marginValue is 0", () => {
      const result = computeCostPlusContract({
        laborCost: 1000,
        expensesTotal: 500,
        marginType: "PERCENT",
        marginValue: 0,
      });
      expect(result.contract).toBe(1500);
      expect(result.margin).toBe(0);
    });

    it("handles zero base (no labor, no expenses)", () => {
      const result = computeCostPlusContract({
        laborCost: 0,
        expensesTotal: 0,
        marginType: "PERCENT",
        marginValue: 25,
      });
      expect(result.contract).toBe(0);
      expect(result.margin).toBe(0);
    });

    it("supports fractional percentages", () => {
      const result = computeCostPlusContract({
        laborCost: 200,
        expensesTotal: 100,
        marginType: "PERCENT",
        marginValue: 12.5,
      });
      expect(result.contract).toBeCloseTo(337.5, 5);
      expect(result.margin).toBeCloseTo(37.5, 5);
    });
  });

  describe("FLAT margin", () => {
    it("adds margin as a fixed amount", () => {
      const result = computeCostPlusContract({
        laborCost: 1000,
        expensesTotal: 500,
        marginType: "FLAT",
        marginValue: 250,
      });
      expect(result.contract).toBe(1750);
      expect(result.margin).toBe(250);
    });

    it("ignores base when computing flat margin (margin is fixed)", () => {
      const result = computeCostPlusContract({
        laborCost: 0,
        expensesTotal: 0,
        marginType: "FLAT",
        marginValue: 500,
      });
      expect(result.contract).toBe(500);
      expect(result.margin).toBe(500);
    });
  });

  describe("null marginType", () => {
    it("returns base with no margin when marginType is null", () => {
      const result = computeCostPlusContract({
        laborCost: 1000,
        expensesTotal: 500,
        marginType: null,
        marginValue: 100,
      });
      expect(result.contract).toBe(1500);
      expect(result.margin).toBe(0);
    });
  });

  describe("expenses-only path", () => {
    it("computes correctly with zero labor", () => {
      const result = computeCostPlusContract({
        laborCost: 0,
        expensesTotal: 1000,
        marginType: "PERCENT",
        marginValue: 15,
      });
      expect(result.contract).toBe(1150);
      expect(result.margin).toBe(150);
    });

    it("computes correctly with zero expenses", () => {
      const result = computeCostPlusContract({
        laborCost: 800,
        expensesTotal: 0,
        marginType: "FLAT",
        marginValue: 200,
      });
      expect(result.contract).toBe(1000);
      expect(result.margin).toBe(200);
    });
  });

  describe("edge cases", () => {
    it("handles negative margin (discount) for PERCENT", () => {
      const result = computeCostPlusContract({
        laborCost: 1000,
        expensesTotal: 0,
        marginType: "PERCENT",
        marginValue: -10,
      });
      expect(result.contract).toBe(900);
      expect(result.margin).toBe(-100);
    });

    it("handles negative margin (discount) for FLAT", () => {
      const result = computeCostPlusContract({
        laborCost: 1000,
        expensesTotal: 0,
        marginType: "FLAT",
        marginValue: -50,
      });
      expect(result.contract).toBe(950);
      expect(result.margin).toBe(-50);
    });
  });
});
