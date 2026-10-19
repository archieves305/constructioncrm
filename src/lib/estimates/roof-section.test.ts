import { describe, expect, it } from "vitest";
import { generateEstimate, type PricedMaterial } from "@/lib/roofing/engine/engine";
import { resolveRules } from "@/lib/roofing/engine/resolve";
import { calculateGenericEstimate } from "./generic-calc";
import { estimateUnitFor, roofSectionFromTakeoff } from "./roof-section";

const materials: PricedMaterial[] = [
  { id: "m1", category: "Shingles", name: "GAF Timberline HDZ", unitType: "bundle", unitCost: 40, roofType: "SHINGLE" },
  { id: "m2", category: "Underlayment", name: "Synthetic underlayment", unitType: "roll", unitCost: 90, roofType: "SHINGLE" },
];

const measurements = { totalSquares: 20, roofAreaSqFt: 2000, pitchedAreaSqFt: 2000, eavesLf: 100, rakesLf: 60 };

describe("roofSectionFromTakeoff", () => {
  const takeoff = generateEstimate("SHINGLE", measurements, resolveRules("SHINGLE", []), materials, { wasteFactorPct: 0.1 });
  const section = roofSectionFromTakeoff(takeoff, { id: "meas1", label: "Main house" });

  it("adds a labor line at the default rate per steep square", () => {
    const labor = section.items.filter((i) => i.costType === "LABOR");
    expect(labor).toHaveLength(1);
    expect(labor[0]).toMatchObject({ unitType: "SQUARE", quantity: 20, unitPrice: 140, description: "Labor — shingle roof" });
    expect(section.laborCost).toBe(2800);
  });

  it("prices each material at its unit cost and keeps the engine's arithmetic as a note", () => {
    const shingles = section.items.find((i) => i.description.startsWith("GAF"));
    expect(shingles).toMatchObject({ costType: "MATERIAL", unitType: "EACH", quantity: 66, unitPrice: 40, description: "GAF Timberline HDZ (bundle)" });
    expect(shingles?.notes).toContain("10% waste");
  });

  it("names the section by roof type, squares and measurement, and links the measurement", () => {
    expect(section.title).toBe("Roofing — Shingle (20 sq) · Main house");
    expect(section.roofMeasurementId).toBe("meas1");
  });

  it("totals in the estimate math to material + labor, split by cost type", () => {
    const b = calculateGenericEstimate({ sections: [section], marginPercent: 0, discountEnabled: false, discountPercent: 0, salesTaxPercent: 0 });
    expect(b.subtotalCost).toBe(section.materialCost + section.laborCost);
    expect(b.costByType.LABOR).toBe(2800);
    expect(b.costByType.MATERIAL).toBe(section.materialCost);
  });

  it("puts the low-slope section on its own labor rate", () => {
    const t = generateEstimate("SHINGLE", { ...measurements, pitchBands: [{ pitch: "6/12", areaSqFt: 1500 }, { pitch: "0/12", areaSqFt: 500 }] }, resolveRules("SHINGLE", []), materials);
    const s = roofSectionFromTakeoff(t, { id: "m", label: null });
    const lines = s.items.filter((i) => i.costType === "LABOR").map((i) => [i.description, i.quantity, i.unitPrice]);
    expect(lines).toEqual([["Labor — shingle roof", 15, 140], ["Labor — low-slope section", 5, 160]]);
  });

  it("follows the company's changed rate and leaves labor out when switched off", () => {
    const changed = generateEstimate("SHINGLE", measurements, resolveRules("SHINGLE", [{ key: "shingle.labor.per_square", value: 155, active: true }]), materials);
    expect(changed.labor[0].lineTotal).toBe(3100);
    const off = generateEstimate("SHINGLE", measurements, resolveRules("SHINGLE", [{ key: "shingle.labor.per_square", value: 140, active: false }]), materials);
    expect(off.labor).toEqual([]);
  });
});

describe("estimateUnitFor", () => {
  it("maps the engine's units and keeps the rest in words", () => {
    expect(estimateUnitFor("lf")).toEqual({ unitType: "LINEAR_FT", inWords: null });
    expect(estimateUnitFor("sheet")).toEqual({ unitType: "SHEET", inWords: null });
    expect(estimateUnitFor("roll")).toEqual({ unitType: "EACH", inWords: "roll" });
  });
});

describe("overhead", () => {
  it("is added to the cost before the margin and is not a job cost", () => {
    const b = calculateGenericEstimate({
      sections: [{ title: "A", items: [{ description: "x", unitType: "EACH", quantity: 1, unitPrice: 1000, costType: "SUB" }] }],
      overheadPercent: 10,
      marginPercent: 20,
      discountEnabled: false,
      discountPercent: 0,
      salesTaxPercent: 0,
    });
    expect(b.subtotalCost).toBe(1000);
    expect(b.overheadAmount).toBe(100);
    expect(b.priceWithMargin).toBe(1375);
    expect(b.marginAmount).toBe(275);
    expect(b.costByType.SUB).toBe(1000);
  });

  it("changes nothing when absent", () => {
    const b = calculateGenericEstimate({ sections: [{ title: "A", items: [{ description: "x", unitType: "EACH", quantity: 2, unitPrice: 50 }] }], marginPercent: 50, discountEnabled: false, discountPercent: 0, salesTaxPercent: 0 });
    expect(b.priceWithMargin).toBe(200);
    expect(b.costByType.OTHER).toBe(100);
  });
});
