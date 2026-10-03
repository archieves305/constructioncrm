import { describe, expect, it } from "vitest";
import { manualOverrides, matchProperty, measurementDifferences, planMaterials, planRuleChanges } from "./import-plan";

const lead = (id: string, street: string, city = "Miami", zip = "33168") => ({ id, propertyAddress1: street, city, zipCode: zip });
const prop = (street: string, city: string | null = "Miami", zip: string | null = "33168") => ({ id: "p", addressLine1: street, city, state: "FL", postalCode: zip });

describe("matchProperty", () => {
  it("matches the same street written differently, with the same zip", () => {
    expect(matchProperty(prop("1061 Northwest 108th Terrace"), [lead("a", "1061 NW 108th Ter"), lead("b", "50 SE 12th St")])).toEqual({ status: "matched", leadId: "a" });
    expect(matchProperty(prop("1061 NW 108th Ter", "Miami", "33168-1234"), [lead("a", "1061 NW 108th Ter.")])).toEqual({ status: "matched", leadId: "a" });
  });
  it("does not match the same street in another zip, or a neighbour", () => {
    expect(matchProperty(prop("1061 NW 108th Ter"), [lead("a", "1061 NW 108th Ter", "Miami", "33169")]).status).toBe("unmatched");
    expect(matchProperty(prop("1061 NW 108th Ter"), [lead("a", "1063 NW 108th Ter")]).status).toBe("unmatched");
  });
  it("without a zip on one side, the city must agree", () => {
    expect(matchProperty(prop("3712 Henry Ave", "West Palm Beach", null), [lead("a", "3712 Henry Avenue", "west palm beach", "33407")]).status).toBe("matched");
    expect(matchProperty(prop("3712 Henry Ave", "Lake Worth", null), [lead("a", "3712 Henry Avenue", "West Palm Beach", "33407")]).status).toBe("unmatched");
    expect(matchProperty(prop("3712 Henry Ave", null, null), [lead("a", "3712 Henry Avenue", "", "")]).status).toBe("unmatched");
  });
  it("two leads at one address go to a person", () => {
    expect(matchProperty(prop("401 NW 3rd Pl", "Dania Beach", "33004"), [lead("a", "401 NW 3rd Place", "Dania Beach", "33004"), lead("b", "401 Northwest 3rd Pl", "Dania Beach", "33004")])).toEqual({ status: "ambiguous", leadIds: ["a", "b"] });
  });
});

describe("planMaterials", () => {
  it("creates what is not here yet, once, whatever the letter case", () => {
    const source = [
      { id: "1", category: "Shingles", name: "GAF Timberline HDZ", roofType: "SHINGLE" },
      { id: "2", category: "Shingles", name: "gaf timberline hdz", roofType: "SHINGLE" },
      { id: "3", category: "Drip Edge", name: "Drip Edge 10'", roofType: null },
      { id: "4", category: "Drip Edge", name: "Drip Edge 10'", roofType: "TILE" },
    ];
    const plan = planMaterials(source, [{ category: "drip edge", name: "DRIP EDGE 10'", roofType: null }]);
    expect(plan.toCreate.map((m) => m.id)).toEqual(["1", "4"]);
    expect(plan.already.map((m) => m.id)).toEqual(["2", "3"]);
  });
});

describe("planRuleChanges", () => {
  it("keeps only rows that differ from the code, and reports rules this app does not have", () => {
    const plan = planRuleChanges([
      { key: "shingle.field.bundles_per_square", value: 3, active: true },
      { key: "shingle.ridgecap.lf_per_bundle", value: 25, active: true },
      { key: "shingle.vents.squares_per_vent", value: 10, active: false },
      { key: "shingle.retired_rule", value: 1, active: true },
      { key: "tile.waste_pct", value: null, active: true },
    ]);
    expect(plan.changes).toEqual([
      { key: "shingle.ridgecap.lf_per_bundle", value: 25, active: true, defaultValue: 23 },
      { key: "shingle.vents.squares_per_vent", value: 10, active: false, defaultValue: 10 },
    ]);
    expect(plan.unknown).toEqual(["shingle.retired_rule"]);
  });
});

describe("measurementDifferences", () => {
  it("lists only real disagreements", () => {
    expect(measurementDifferences({ totalSquares: 31.6, eavesLf: 306.08, valleysLf: null, predominantPitch: "2/12" }, { totalSquares: 31.6, eavesLf: 306.083, predominantPitch: "2/12" })).toEqual([]);
    expect(measurementDifferences({ eavesLf: 310, penetrations: 6 }, { eavesLf: 306.08 })).toEqual([
      { field: "eavesLf", stored: 310, parsed: 306.08 },
      { field: "penetrations", stored: 6, parsed: null },
    ]);
  });
});

describe("manualOverrides", () => {
  it("reads the typed values and ignores anything that is not a measurement", () => {
    expect(manualOverrides({ eavesLf: { value: 310, by: "a@b.c", at: "x" }, penetrations: { value: 6 }, suggestedWastePct: { value: 0.1 }, junk: 5 })).toEqual({ eavesLf: 310, penetrations: 6 });
    expect(manualOverrides(null)).toEqual({});
  });
});
