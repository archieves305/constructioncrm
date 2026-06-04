import { describe, expect, it } from "vitest";
import type { NormalizedProperty } from "./normalize";
import { estimateRoofAge, formatRoofAge } from "./roof-age";

const NOW = new Date("2026-06-04T12:00:00Z");

const mk = (o: Partial<NormalizedProperty>): NormalizedProperty =>
  ({ lastRoofPermitDate: null, yearBuilt: null, ...o } as NormalizedProperty);

describe("estimateRoofAge", () => {
  it("Priority 1: uses the most recent roof permit date", () => {
    const e = estimateRoofAge(mk({ lastRoofPermitDate: "2010-07-01", yearBuilt: 1990 }), NOW);
    expect(e).toEqual({ years: 16, basis: "permit" });
  });

  it("Priority 2: falls back to year built when no permit exists", () => {
    const e = estimateRoofAge(mk({ yearBuilt: 2005 }), NOW);
    expect(e).toEqual({ years: 21, basis: "yearBuilt" });
  });

  it("Priority 3: unknown when neither is available", () => {
    expect(estimateRoofAge(mk({}), NOW)).toEqual({ years: null, basis: "unknown" });
  });
});

describe("formatRoofAge", () => {
  it("renders the three spec phrasings", () => {
    expect(formatRoofAge({ years: 21, basis: "permit" })).toBe("21 years");
    expect(formatRoofAge({ years: 21, basis: "yearBuilt" })).toBe(
      "Approx. 21 years based on year built",
    );
    expect(formatRoofAge({ years: null, basis: "unknown" })).toBe("Unknown");
  });
});
