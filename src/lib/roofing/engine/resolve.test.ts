import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./defaults";
import { generateEstimate } from "./engine";
import { priceAgeDays, priceInForce, pricedCatalog, resolveRules, ruleRows, ruleValueProblem, type CatalogItem } from "./resolve";

const day = (s: string) => new Date(`${s}T12:00:00Z`);
const item = (over: Partial<CatalogItem>): CatalogItem => ({ id: "i", category: "Shingles", name: "A", sku: null, roofType: "SHINGLE", unitType: "bundle", isPreferred: false, isActive: true, prices: [], ...over });

describe("resolveRules", () => {
  it("with nothing saved, runs the code's rules for that roof type and no other", () => {
    const rules = resolveRules("SHINGLE", []);
    expect(rules.length).toBe(DEFAULT_RULES.filter((d) => d.roofType === "SHINGLE" || d.roofType === null).length);
    expect(rules.some((r) => r.key.startsWith("tile."))).toBe(false);
  });

  it("a saved number replaces the default", () => {
    const rules = resolveRules("SHINGLE", [{ key: "shingle.field.bundles_per_square", value: 3.05, active: true }]);
    expect(rules.find((r) => r.key === "shingle.field.bundles_per_square")!.value).toBe(3.05);
  });

  it("a rule switched off is gone — it does not fall back to the default", () => {
    const rules = resolveRules("SHINGLE", [{ key: "shingle.vents.squares_per_vent", value: 10, active: false }]);
    expect(rules.find((r) => r.key === "shingle.vents.squares_per_vent")).toBeUndefined();
    const result = generateEstimate("SHINGLE", { totalSquares: 30, eavesLf: 100, rakesLf: 80 }, rules, []);
    expect(result.items.some((i) => i.ruleKey === "shingle.vents.squares_per_vent")).toBe(false);
  });

  it("ignores a saved change for a rule the code no longer has", () => {
    expect(resolveRules("SHINGLE", [{ key: "shingle.gone", value: 1, active: true }]).some((r) => r.key === "shingle.gone")).toBe(false);
  });
});

describe("ruleRows", () => {
  it("marks what the company changed and keeps the default beside it", () => {
    const rows = ruleRows([{ key: "tile.waste_pct", value: 0.15, active: true }, { key: "metal.waste_pct", value: 0.08, active: true }]);
    expect(rows.find((r) => r.key === "tile.waste_pct")).toMatchObject({ value: 0.15, defaultValue: 0.12, changed: true });
    expect(rows.find((r) => r.key === "metal.waste_pct")!.changed).toBe(false);
  });
});

describe("ruleValueProblem", () => {
  it("refuses a zero coverage, a negative, and a waste written as a percentage", () => {
    expect(ruleValueProblem("lf_per_unit", 0)).toMatch(/switch the rule off/);
    expect(ruleValueProblem("per_square", -1)).toMatch(/negative/);
    expect(ruleValueProblem("waste_pct", 10)).toMatch(/fraction/);
    expect(ruleValueProblem("per_lf", "2")).toMatch(/number/);
  });
  it("accepts zero for a multiplier (the rule then orders nothing)", () => {
    expect(ruleValueProblem("per_lf", 0)).toBeNull();
    expect(ruleValueProblem("waste_pct", 0.12)).toBeNull();
  });
});

describe("priceInForce", () => {
  const prices = [
    { unitCost: 38, effectiveDate: day("2026-01-01") },
    { unitCost: 41, effectiveDate: day("2026-06-01") },
    { unitCost: 45, effectiveDate: day("2026-12-01") },
  ];
  it("is the latest price effective that day or earlier — a future price waits", () => {
    expect(priceInForce(prices, "2026-10-03")!.unitCost).toBe(41);
    expect(priceInForce(prices, "2026-03-01")!.unitCost).toBe(38);
    expect(priceInForce(prices, "2025-12-31")).toBeNull();
  });
  it("takes effect on its day whatever the hour, and from that day on", () => {
    expect(priceInForce(prices, "2026-06-01")!.unitCost).toBe(41);
    expect(priceInForce(prices, "2026-05-31")!.unitCost).toBe(38);
  });
  it("two prices for the same day: the one entered later is the correction", () => {
    const same = [
      { unitCost: 11.25, effectiveDate: day("2026-10-03"), createdAt: new Date("2026-10-03T23:40:00Z") },
      { unitCost: 12, effectiveDate: day("2026-10-03"), createdAt: new Date("2026-10-03T23:41:00Z") },
    ];
    expect(priceInForce(same, "2026-10-03")!.unitCost).toBe(12);
    expect(priceInForce([...same].reverse(), "2026-10-03")!.unitCost).toBe(12);
  });
  it("knows how old it is", () => {
    expect(priceAgeDays(priceInForce(prices, "2026-10-03"), "2026-10-03")).toBe(124);
    expect(priceAgeDays(null, "2026-10-03")).toBeNull();
  });
});

describe("pricedCatalog", () => {
  const asOf = "2026-10-03";
  const p = (n: number) => [{ unitCost: n, effectiveDate: day("2026-09-01") }];

  it("puts the preferred item first, so the takeoff uses it", () => {
    const catalog = pricedCatalog([item({ id: "a", name: "Economy", prices: p(30) }), item({ id: "b", name: "Timberline HDZ", isPreferred: true, prices: p(42) })], "SHINGLE", asOf);
    expect(catalog[0].id).toBe("b");
    const result = generateEstimate("SHINGLE", { totalSquares: 10, eavesLf: 1, rakesLf: 1 }, resolveRules("SHINGLE", []), catalog);
    expect(result.items.find((i) => i.category === "Shingles")).toMatchObject({ name: "Timberline HDZ", unitCost: 42 });
  });

  it("an item for this roof type beats one for any roof; priced beats unpriced; inactive and other roof types are out", () => {
    const catalog = pricedCatalog(
      [
        item({ id: "any", name: "Any", roofType: null, category: "Drip Edge", prices: p(11) }),
        item({ id: "own", name: "Own", category: "Drip Edge", prices: p(12) }),
        item({ id: "unpriced", name: "Aaa", category: "Drip Edge" }),
        item({ id: "off", name: "Off", category: "Drip Edge", isActive: false, isPreferred: true, prices: p(1) }),
        item({ id: "tile", name: "Tile", roofType: "TILE", category: "Drip Edge", prices: p(1) }),
      ],
      "SHINGLE",
      asOf,
    );
    expect(catalog.map((c) => c.id)).toEqual(["own", "unpriced", "any"]);
  });

  it("an item with no price in force is priced 0, and the engine warns instead of guessing", () => {
    const catalog = pricedCatalog([item({ name: "Future", prices: [{ unitCost: 50, effectiveDate: day("2027-01-01") }] })], "SHINGLE", asOf);
    expect(catalog[0].unitCost).toBe(0);
    const result = generateEstimate("SHINGLE", { totalSquares: 10, eavesLf: 1, rakesLf: 1 }, resolveRules("SHINGLE", []), catalog);
    expect(result.warnings.join(" ")).toMatch(/Future.*no active price/);
  });
});
