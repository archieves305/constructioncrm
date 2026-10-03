import { describe, it, expect } from "vitest";
import { generateEstimate, type PricedMaterial, type ResolvedRule } from "./engine";
import { DEFAULT_RULES } from "./defaults";
import type { Measurements, RoofType } from "../types";

function rulesFor(rt: RoofType): ResolvedRule[] {
  return DEFAULT_RULES.filter((d) => d.roofType === rt || d.roofType === null).map((d) => ({
    key: d.key, label: d.label, category: d.category, kind: d.kind,
    inputMetric: d.inputMetric ?? null, value: d.value, unit: d.unit ?? null, params: d.params ?? null,
  }));
}

// Minimal priced catalog covering the categories each roof type uses.
function pricedFor(rt: RoofType): PricedMaterial[] {
  const cats: Record<string, [string, number]> = {
    Shingles: ["bundle", 40], Starter: ["bundle", 60], "Ridge Cap": ["bundle", 64],
    Underlayment: ["roll", 90], "Ice & Water": ["roll", 100], "Drip Edge": ["piece", 11],
    Valley: ["roll", 78], Flashing: ["each", 18], Ventilation: ["each", 14], Fasteners: ["box", 52], Sealant: ["tube", 6],
    "Field Tile": ["piece", 2], "Ridge Tile": ["piece", 4], "Hip Tile": ["piece", 4], "Eave Closure": ["piece", 2],
    Battens: ["lf", 0.65], Adhesive: ["each", 58],
    Panels: ["panel", 96], "Hip Cap": ["piece", 42], "Eave Trim": ["piece", 22], "Rake Trim": ["piece", 24],
    "Valley Trim": ["piece", 34], Closures: ["piece", 16], "Butyl Tape": ["roll", 19],
    "Flat Base Sheet": ["roll", 114], "Flat Ply Sheet": ["roll", 110], "Flat Cap Sheet": ["roll", 100],
  };
  return Object.entries(cats).map(([category, [unitType, unitCost]], i) => ({
    id: `m${i}`, category, name: `${category} material`, unitType, unitCost, roofType: rt,
  }));
}

const shingleMeasure: Measurements = {
  totalSquares: 30, roofAreaSqFt: 3000, facets: 8, eavesLf: 100, rakesLf: 80,
  valleysLf: 40, hipsLf: 20, ridgesLf: 50, penetrations: 5, suggestedWastePct: 0.1,
};

describe("shingle estimate", () => {
  const result = generateEstimate("SHINGLE", shingleMeasure, rulesFor("SHINGLE"), pricedFor("SHINGLE"));

  it("orders field shingles = squares × 3 + 10% waste, rounded up", () => {
    const shingles = result.items.find((i) => i.category === "Shingles")!;
    // 30 sq × 3 = 90 bundles, +10% = 99 → ceil 99
    expect(shingles.baseQuantity).toBe(90);
    expect(shingles.quantity).toBe(99);
    expect(shingles.wasteApplied).toBe(true);
  });

  it("derives drip edge (10' sheets) from eaves + rakes, with waste (Roofr basis)", () => {
    const drip = result.items.find((i) => i.category === "Drip Edge")!;
    // (100 + 80) / 10 = 18 base sheets; +10% waste = 19.8 → 20
    expect(drip.baseQuantity).toBe(18);
    expect(drip.quantity).toBe(20);
    expect(drip.wasteApplied).toBe(true);
  });

  it("orders one pipe boot per penetration", () => {
    const boots = result.items.find((i) => i.ruleKey === "shingle.pipeboots.per_penetration")!;
    expect(boots.quantity).toBe(5);
  });

  it("produces a positive, priced subtotal", () => {
    expect(result.subtotal).toBeGreaterThan(0);
    expect(result.total).toBe(result.subtotal);
    expect(result.items.every((i) => i.unitCost > 0)).toBe(true);
  });

  it("honors an explicit waste override", () => {
    const r2 = generateEstimate("SHINGLE", shingleMeasure, rulesFor("SHINGLE"), pricedFor("SHINGLE"), { wasteFactorPct: 0.2 });
    const shingles = r2.items.find((i) => i.category === "Shingles")!;
    expect(shingles.quantity).toBe(108); // 90 × 1.2
  });
});

describe("tile estimate", () => {
  const measure: Measurements = { totalSquares: 30, roofAreaSqFt: 3000, eavesLf: 100, rakesLf: 80, valleysLf: 40, hipsLf: 20, ridgesLf: 50, penetrations: 5 };
  it("includes battens only when battenInstall is set", () => {
    const without = generateEstimate("TILE", measure, rulesFor("TILE"), pricedFor("TILE"), { battenInstall: false });
    const withB = generateEstimate("TILE", measure, rulesFor("TILE"), pricedFor("TILE"), { battenInstall: true });
    expect(without.items.some((i) => i.category === "Battens")).toBe(false);
    expect(withB.items.some((i) => i.category === "Battens")).toBe(true);
  });
});

describe("mixed steep + flat roof (737 W Ilex, summary split)", () => {
  // Roofr: total 2436 = 1666 pitched (3/12) + 771 flat (1/12). No pitch bands here,
  // so the engine uses Roofr's pitched/flat summary. 1/12 < 2/12 → membrane (correct).
  const measure: Measurements = {
    totalSquares: 24.4, roofAreaSqFt: 2436, pitchedAreaSqFt: 1666, flatAreaSqFt: 771,
    eavesLf: 150.92, rakesLf: 154.83, valleysLf: 0, hipsLf: 0, ridgesLf: 81.5,
    penetrations: 0, suggestedWastePct: 0.1,
  };
  const result = generateEstimate("SHINGLE", measure, rulesFor("SHINGLE"), pricedFor("SHINGLE"));

  it("computes field shingles off pitched area (16.7 sq), not the 24.4 sq total", () => {
    const shingles = result.items.find((i) => i.category === "Shingles")!;
    expect(shingles.baseQuantity).toBeCloseTo(50.1, 1); // 16.7 × 3
  });

  it("emits the 3-layer flat membrane off the 7.7 sq low-slope area", () => {
    const cap = result.items.find((i) => i.category === "Flat Cap Sheet");
    const ply = result.items.find((i) => i.category === "Flat Ply Sheet");
    const base = result.items.find((i) => i.category === "Flat Base Sheet");
    expect(cap && ply && base).toBeTruthy();
    expect(cap!.quantity).toBe(10); // 7.7 / 0.8 = 9.6 → 10
    expect(base!.quantity).toBe(5); // 7.7 / 1.6 = 4.8 → 5
  });
});

describe("mostly-flat roof with pitch bands (1061 NW 108th) matches the SRS invoice", () => {
  // Per-pitch table: 0/12=630, 2/12=2295, 4/12=231. At the 2/12 threshold KNU
  // shingles 2/12+4/12 (2526 sqft) and membranes only the 0/12 (630 sqft) — exactly
  // what SRS Quote 0047423240 ordered (75 shingle bundles, 8 cap rolls).
  const measure: Measurements = {
    roofAreaSqFt: 3155, pitchedAreaSqFt: 231, flatAreaSqFt: 2924,
    pitchBands: [
      { pitch: "0/12", areaSqFt: 630 },
      { pitch: "2/12", areaSqFt: 2295 },
      { pitch: "4/12", areaSqFt: 231 },
    ],
    eavesLf: 306.08, ridgesLf: 42.33, suggestedWastePct: 0,
  };
  const result = generateEstimate("SHINGLE", measure, rulesFor("SHINGLE"), pricedFor("SHINGLE"));

  it("shingles the 2/12+4/12 area (≈25 sq), not Roofr's 2.3 pitched squares", () => {
    const shingles = result.items.find((i) => i.category === "Shingles")!;
    // 2526 sqft → 25.3 sq × 3 = 75.9 bundles base (invoice ordered 75)
    expect(shingles.baseQuantity).toBeCloseTo(75.9, 0);
  });

  it("membranes only the 0/12 (6.3 sq): base 4, ply 4, cap 8 rolls — the invoice exactly", () => {
    const cap = result.items.find((i) => i.category === "Flat Cap Sheet")!;
    const ply = result.items.find((i) => i.category === "Flat Ply Sheet")!;
    const base = result.items.find((i) => i.category === "Flat Base Sheet")!;
    expect(base.quantity).toBe(4); // 6.3 / 1.6 = 3.9 → 4
    expect(ply.quantity).toBe(4);
    expect(cap.quantity).toBe(8); // 6.3 / 0.8 = 7.9 → 8
  });

  it("respects a configurable threshold: at 3/12, the 2/12 area becomes low-slope", () => {
    const r = generateEstimate("SHINGLE", measure, rulesFor("SHINGLE"), pricedFor("SHINGLE"), { lowSlopeRise: 3 });
    const shingles = r.items.find((i) => i.category === "Shingles")!;
    // only 4/12 (231 sqft = 2.3 sq) stays steep → 2.3 × 3 = 6.9
    expect(shingles.baseQuantity).toBeCloseTo(6.9, 0);
  });
});

describe("single-slope roof emits no flat line items", () => {
  it("stays dormant when there is no flat area", () => {
    const r = generateEstimate("SHINGLE", shingleMeasure, rulesFor("SHINGLE"), pricedFor("SHINGLE"));
    expect(r.items.some((i) => i.category.startsWith("Flat "))).toBe(false);
    expect(r.warnings.some((w) => /low-slope/i.test(w))).toBe(false);
  });
});

describe("metal estimate", () => {
  it("computes panel count from roof area and panel coverage", () => {
    const measure: Measurements = { totalSquares: 30, roofAreaSqFt: 3000, eavesLf: 100, rakesLf: 80, valleysLf: 40, hipsLf: 20, ridgesLf: 50, penetrations: 5 };
    const r = generateEstimate("METAL", measure, rulesFor("METAL"), pricedFor("METAL"));
    const panels = r.items.find((i) => i.category === "Panels")!;
    // coverage = (16/12)*12 = 16 sqft/panel; 3000/16 = 187.5 → +8% waste = 202.5 → ceil 203
    expect(panels.baseQuantity).toBeCloseTo(187.5, 1);
    expect(panels.quantity).toBe(203);
  });
});

// Money. The estimator's own tests only checked that the subtotal was above
// zero; these pin the arithmetic a customer's price is built on.
describe("money arithmetic", () => {
  const cents = (n: number) => Math.round(n * 100);

  for (const rt of ["SHINGLE", "TILE", "METAL"] as RoofType[]) {
    const result = generateEstimate(rt, shingleMeasure, rulesFor(rt), pricedFor(rt));

    it(`${rt}: every line total is quantity × unit cost to the cent`, () => {
      expect(result.items.length).toBeGreaterThan(3);
      for (const line of result.items) {
        expect(cents(line.lineTotal)).toBe(Math.round(line.quantity * line.unitCost * 100));
      }
    });

    it(`${rt}: the subtotal is the sum of the line totals, and the total equals it (materials only)`, () => {
      const sum = result.items.reduce((s, line) => s + cents(line.lineTotal), 0);
      expect(cents(result.subtotal)).toBe(sum);
      expect(result.total).toBe(result.subtotal);
    });

    it(`${rt}: whole units are never ordered in fractions`, () => {
      const discrete = new Set(["bundle", "roll", "piece", "each", "box", "tube", "bag", "panel", "sheet", "bucket", "gallon"]);
      for (const line of result.items) {
        if (discrete.has(line.unitType)) expect(Number.isInteger(line.quantity)).toBe(true);
      }
    });
  }

  it("the 30-square shingle roof prices at a fixed figure (regression pin)", () => {
    const result = generateEstimate("SHINGLE", shingleMeasure, rulesFor("SHINGLE"), pricedFor("SHINGLE"));
    // 99 bundles of field shingle at $40 is $3,960 of it; a change to any
    // coefficient, waste rule or rounding moves this number and must be deliberate.
    expect(result.items.find((i) => i.category === "Shingles")!.lineTotal).toBe(3960);
    expect(result.subtotal).toMatchInlineSnapshot(`5860`);
  });

  it("a material with no price is a $0 line with a warning, never a guess", () => {
    const priced = pricedFor("SHINGLE").filter((m) => m.category !== "Starter");
    const result = generateEstimate("SHINGLE", shingleMeasure, rulesFor("SHINGLE"), priced);
    const starter = result.items.find((i) => i.category === "Starter");
    expect(starter?.unitCost ?? 0).toBe(0);
    expect(starter?.lineTotal ?? 0).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/Starter/i);
  });
});
