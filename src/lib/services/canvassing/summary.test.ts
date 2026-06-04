import { describe, expect, it } from "vitest";
import type { NormalizedProperty } from "./normalize";
import { computeKnockScore } from "./score";
import { buildCanvasserSummary } from "./summary";

const NOW = new Date("2026-06-04T12:00:00Z");

function mk(overrides: Partial<NormalizedProperty> = {}): NormalizedProperty {
  return {
    reapiId: "r1",
    propertyAddress: "1423 Example St",
    city: "Fort Lauderdale",
    state: "FL",
    zip: "33301",
    ownerName: null,
    mailingAddress: null,
    ownerOccupied: null,
    yearBuilt: null,
    propertyType: null,
    buildingSqft: null,
    stories: null,
    lotSizeSqft: null,
    roofType: null,
    lastSaleDate: null,
    lastSalePrice: null,
    ownedSince: null,
    estimatedValue: null,
    estimatedMortgageBalance: null,
    estimatedEquity: null,
    equityPercentage: null,
    lastRoofPermitDate: null,
    hasRoofPermit: false,
    ...overrides,
  };
}

const summarize = (n: NormalizedProperty, canvasserName = "Maria") =>
  buildCanvasserSummary(n, computeKnockScore(n, undefined, NOW), { canvasserName });

describe("buildCanvasserSummary — opening logic (spec §8)", () => {
  it("greets the owner by name when roof age and name are known", () => {
    const n = mk({ ownerName: "John Smith", yearBuilt: 1998, lastRoofPermitDate: "2007-03-01", hasRoofPermit: true, ownerOccupied: true });
    const s = summarize(n);
    expect(s.recommendedOpening).toContain("Hi John");
    expect(s.recommendedOpening).toContain("Maria");
    expect(s.isAbsentee).toBe(false);
  });

  it("uses the neighborhood opening when the roof age is unknown but the home is older", () => {
    const n = mk({ ownerName: "Jane Doe", yearBuilt: 1995 });
    const s = summarize(n);
    expect(s.recommendedOpening.toLowerCase()).toContain("neighborhood");
  });

  it("flags absentee owners and recommends phone/mail instead of knocking", () => {
    const n = mk({ ownerName: "Bob Lee", ownerOccupied: false, yearBuilt: 1990 });
    const s = summarize(n);
    expect(s.isAbsentee).toBe(true);
    expect(s.recommendedOpening.toLowerCase()).toContain("absentee");
    expect(s.cautionNotes[0].toLowerCase()).toContain("absentee");
  });
});

describe("buildCanvasserSummary — angles", () => {
  it("surfaces a financing angle for high-equity homes", () => {
    const n = mk({ equityPercentage: 78, estimatedEquity: 300000, estimatedValue: 385000 });
    expect(summarize(n).financingAngle).not.toBeNull();
  });

  it("omits the financing angle for low-equity homes", () => {
    const n = mk({ equityPercentage: 15, estimatedEquity: 30000, estimatedValue: 200000 });
    expect(summarize(n).financingAngle).toBeNull();
  });

  it("surfaces an insurance angle for older roofs and omits it for newer ones", () => {
    expect(summarize(mk({ yearBuilt: 1995 })).insuranceAngle).not.toBeNull();
    expect(summarize(mk({ yearBuilt: 2024, lastRoofPermitDate: "2024-01-01", hasRoofPermit: true })).insuranceAngle).toBeNull();
  });
});

describe("buildCanvasserSummary — compliance", () => {
  it("always includes caution notes and a disclaimer", () => {
    const s = summarize(mk());
    expect(s.cautionNotes.length).toBeGreaterThanOrEqual(5);
    expect(s.disclaimer.length).toBeGreaterThan(0);
  });

  it("never asserts knowledge of the homeowner's equity", () => {
    const blob = JSON.stringify(summarize(mk({ equityPercentage: 90, estimatedEquity: 1, estimatedValue: 1 })));
    expect(blob.toLowerCase()).not.toContain("we know your equity");
  });
});
