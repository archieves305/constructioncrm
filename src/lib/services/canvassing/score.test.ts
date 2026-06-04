import { describe, expect, it } from "vitest";
import type { NormalizedProperty } from "./normalize";
import { computeKnockScore, tierFor } from "./score";
import { DEFAULT_SCORING_CONFIG } from "./scoring-config";

const NOW = new Date("2026-06-04T12:00:00Z");

// Fully-null normalized property; override only what a test cares about.
function mk(overrides: Partial<NormalizedProperty> = {}): NormalizedProperty {
  return {
    reapiId: "r1",
    propertyAddress: null,
    city: null,
    state: null,
    zip: null,
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

describe("computeKnockScore — section logic", () => {
  it("scores roof age bands from a confirmed permit date", () => {
    // 19-year-old roof (permit) → 16–20 band = 25, permit >15y → +5 = 30.
    const n = mk({ lastRoofPermitDate: "2007-03-01", hasRoofPermit: true, yearBuilt: 1998 });
    expect(computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW).breakdown.roof).toBe(30);
  });

  it("caps roof age inferred from year built well below a confirmed old roof", () => {
    // No permit, built 1998 (28y old) → unknownAgeBuiltOver20 = 15, and the
    // no-permit/15+ bonus is 0 (missing permits are a data gap, not signal) → 15
    // (far below the confirmed-old-roof 35).
    const n = mk({ yearBuilt: 1998 });
    expect(computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW).breakdown.roof).toBe(15);
  });

  it("subtracts for a roof permit pulled within the last 10 years", () => {
    // 4-year-old roof → 0–10 band = 5, within-10y penalty -10 → clamped to 0.
    const n = mk({ lastRoofPermitDate: "2022-01-01", hasRoofPermit: true, yearBuilt: 1998 });
    expect(computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW).breakdown.roof).toBe(0);
  });

  it("scores equity bands", () => {
    expect(computeKnockScore(mk({ equityPercentage: 72, estimatedEquity: 1 }), DEFAULT_SCORING_CONFIG, NOW).breakdown.financial).toBe(20);
    expect(computeKnockScore(mk({ equityPercentage: 100, estimatedEquity: 1 }), DEFAULT_SCORING_CONFIG, NOW).breakdown.financial).toBe(25);
    expect(computeKnockScore(mk({ equityPercentage: 10, estimatedEquity: 1 }), DEFAULT_SCORING_CONFIG, NOW).breakdown.financial).toBe(5);
  });

  it("scores conversion from occupancy + ownership duration", () => {
    // Owner-occupied (10) + owned since 2006 = 20y (10) = 20.
    const n = mk({ ownerOccupied: true, ownedSince: 2006 });
    expect(computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW).breakdown.conversion).toBe(20);
    // Absentee (2) + owned 2y (2) = 4.
    const a = mk({ ownerOccupied: false, ownedSince: 2024 });
    expect(computeKnockScore(a, DEFAULT_SCORING_CONFIG, NOW).breakdown.conversion).toBe(4);
  });

  it("scores personalization from owner name, roof type, and detail", () => {
    const n = mk({ ownerName: "John Smith", roofType: "Shingle", yearBuilt: 1998, estimatedValue: 500000 });
    expect(computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW).breakdown.personalization).toBe(15);
  });
});

describe("computeKnockScore — worked example & tiers", () => {
  it("scores the spec's example property as an Excellent Door Knock", () => {
    // 1423 Example St: built 1998, owned since 2006, roof ~19y by permit,
    // equity 72%, owner-occupied, roof type known.
    const n = mk({
      ownerName: "John Smith",
      yearBuilt: 1998,
      ownedSince: 2006,
      lastRoofPermitDate: "2007-03-01",
      hasRoofPermit: true,
      equityPercentage: 72,
      estimatedEquity: 410000,
      estimatedValue: 569444,
      roofType: "Asphalt Shingle",
      ownerOccupied: true,
    });
    const r = computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW);
    // 30 roof + 20 financial + 20 conversion + 15 personalization = 85.
    expect(r.score).toBe(85);
    expect(r.tier).toBe("Excellent Door Knock");
  });

  it("maps scores to the right tier at the boundaries", () => {
    const t = (s: number) => tierFor(s, DEFAULT_SCORING_CONFIG);
    expect(t(85)).toBe("Excellent Door Knock");
    expect(t(84)).toBe("Strong Door Knock");
    expect(t(70)).toBe("Strong Door Knock");
    expect(t(69)).toBe("Average Door Knock");
    expect(t(50)).toBe("Average Door Knock");
    expect(t(49)).toBe("Low Priority");
    expect(t(30)).toBe("Low Priority");
    expect(t(29)).toBe("Skip / Low Value");
    expect(t(0)).toBe("Skip / Low Value");
  });
});

describe("computeKnockScore — missing data", () => {
  it("returns a low Skip score and never throws when everything is unknown", () => {
    const r = computeKnockScore(mk(), DEFAULT_SCORING_CONFIG, NOW);
    expect(r.score).toBe(0);
    expect(r.tier).toBe("Skip / Low Value");
    expect(r.breakdown.roofAge.basis).toBe("unknown");
    expect(r.breakdown.equityPercentage).toBeNull();
  });

  it("never exceeds 100 even with a maxed-out property", () => {
    const n = mk({
      ownerName: "A B",
      roofType: "Tile",
      yearBuilt: 1980,
      estimatedValue: 800000,
      equityPercentage: 100,
      estimatedEquity: 800000,
      ownerOccupied: true,
      ownedSince: 1990,
      lastRoofPermitDate: "2000-01-01",
      hasRoofPermit: true,
    });
    expect(computeKnockScore(n, DEFAULT_SCORING_CONFIG, NOW).score).toBeLessThanOrEqual(100);
  });
});
