import { describe, expect, it } from "vitest";
import { applyEdits, columnsFromParse, reviewState, toEngineMeasurements, validBands, valueProblem } from "./measurements";
import type { RoofrParseResult } from "./types";

const parse: RoofrParseResult = {
  parsedAddress: "1061 NW 108th Ter, Miami, FL",
  measurements: { totalSquares: 31.6, roofAreaSqFt: 2925, eavesLf: 306.08, rakesLf: 2, facets: 9.0, predominantPitch: "2/12", pitchBands: [{ pitch: "0/12", areaSqFt: 630 }, { pitch: "2/12", areaSqFt: 2295 }] },
  fieldConfidence: { totalSquares: 0.95, eavesLf: 0.6 },
  confidence: 0.91,
  usedOcr: false,
  rawText: "…",
  rawExtract: { totalSquares: "31.6" },
  warnings: [],
  reportWaste: { recommendedPct: 0.06, options: [0, 0.06, 0.1] },
};
const who = "u1";
const at = new Date("2026-10-03T15:00:00Z");

describe("columnsFromParse", () => {
  const c = columnsFromParse(parse);
  it("stores what was read and leaves what was not read empty, never zero", () => {
    expect(c.totalSquares).toBe(31.6);
    expect(c.valleysLf).toBeNull();
    expect(c.penetrations).toBeNull();
    expect(c.predominantPitch).toBe("2/12");
    expect(c.pitchBands).toHaveLength(2);
  });
  it("keeps the report's waste beside the measurements", () => {
    expect(c.reportWastePct).toBe(0.06);
    expect(c.reportWasteOptions).toEqual([0, 0.06, 0.1]);
  });
  it("drops malformed pitch bands", () => {
    expect(validBands([{ pitch: "6/12", areaSqFt: 100 }, { pitch: "steep", areaSqFt: 5 }, { pitch: "4/12", areaSqFt: -1 }])).toEqual([{ pitch: "6/12", areaSqFt: 100 }]);
    expect(validBands("x")).toBeNull();
  });
});

describe("valueProblem", () => {
  it("refuses negatives, fractions of a count and a malformed pitch", () => {
    expect(valueProblem("eavesLf", -1)).toMatch(/negative/);
    expect(valueProblem("penetrations", 2.5)).toMatch(/whole/);
    expect(valueProblem("predominantPitch", "steep")).toMatch(/6\/12/);
    expect(valueProblem("eavesLf", "12" as unknown)).toMatch(/number/);
  });
  it("accepts a number, a pitch and clearing a field", () => {
    expect(valueProblem("eavesLf", 120.5)).toBeNull();
    expect(valueProblem("predominantPitch", "6/12")).toBeNull();
    expect(valueProblem("valleysLf", null)).toBeNull();
  });
});

describe("applyEdits", () => {
  it("writes only what changed and remembers what it replaced", () => {
    const r = applyEdits({ eavesLf: 306.08, rakesLf: 2 }, null, { eavesLf: 310, rakesLf: 2 }, who, at);
    expect(r.data).toEqual({ eavesLf: 310 });
    expect(r.changed).toEqual(["eavesLf"]);
    expect(r.overrides.eavesLf).toEqual({ value: 310, previous: 306.08, by: "u1", at: at.toISOString() });
  });
  it("keeps the report's own reading through a second correction, and clears the override when it is restored", () => {
    const first = applyEdits({ eavesLf: 306.08 }, null, { eavesLf: 310 }, who, at);
    const second = applyEdits({ eavesLf: 310 }, first.overrides, { eavesLf: 320 }, "u2", at);
    expect(second.overrides.eavesLf?.previous).toBe(306.08);
    const back = applyEdits({ eavesLf: 320 }, second.overrides, { eavesLf: 306.08 }, who, at);
    expect(back.overrides.eavesLf).toBeUndefined();
    expect(back.data).toEqual({ eavesLf: 306.08 });
  });
  it("records a count a report never gives", () => {
    const r = applyEdits({ penetrations: null }, null, { penetrations: 6 }, who, at);
    expect(r.overrides.penetrations?.previous).toBeNull();
  });
});

describe("reviewState", () => {
  const base = { source: "ROOFR" as const, parseConfidence: 0.91, fieldConfidence: { eavesLf: 0.6, totalSquares: 0.95 }, overrides: null, reviewedAt: null, values: { totalSquares: 31.6, eavesLf: 306, rakesLf: 2 } };
  it("flags a field the parser was unsure of until someone corrects it or reviews the report", () => {
    expect(reviewState(base)).toMatchObject({ needsReview: true, unsureFields: ["eavesLf"] });
    expect(reviewState({ ...base, overrides: { eavesLf: { value: 310, previous: 306, by: "u", at: "x" } } }).needsReview).toBe(false);
    expect(reviewState({ ...base, reviewedAt: at }).needsReview).toBe(false);
  });
  it("flags a report that was hard to read", () => {
    expect(reviewState({ ...base, parseConfidence: 0.4, fieldConfidence: {} }).reasons).toContain("The report was hard to read");
  });
  it("a missing essential is flagged even after review — an estimate cannot be made without it", () => {
    const r = reviewState({ ...base, reviewedAt: at, values: { totalSquares: 31.6, eavesLf: null, rakesLf: 2 } });
    expect(r.needsReview).toBe(true);
    expect(r.reasons[0]).toBe("Missing: eaves");
  });
  it("roof area stands in for squares; hand-typed measurements have no parser doubts", () => {
    expect(reviewState({ ...base, fieldConfidence: {}, values: { roofAreaSqFt: 3000, eavesLf: 1, rakesLf: 1 } }).needsReview).toBe(false);
    expect(reviewState({ ...base, source: "MANUAL", parseConfidence: null, values: { totalSquares: 30, eavesLf: 1, rakesLf: 1 } }).needsReview).toBe(false);
  });
});

describe("toEngineMeasurements", () => {
  it("hands the engine the takeoff fields and valid bands only", () => {
    const m = toEngineMeasurements({ totalSquares: 30, eavesLf: 100, stories: 2, skylights: 1, pitchBands: [{ pitch: "6/12", areaSqFt: 3000 }] });
    expect(m.totalSquares).toBe(30);
    expect(m.pitchBands).toEqual([{ pitch: "6/12", areaSqFt: 3000 }]);
    expect("stories" in m).toBe(false);
    expect(m.valleysLf).toBeNull();
  });
});
