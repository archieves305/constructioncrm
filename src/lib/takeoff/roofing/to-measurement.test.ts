import { describe, expect, it } from "vitest";
import { bandOf, parseSlope, slopedArea, takeoffToMeasurement, type TakeoffRowInput } from "./to-measurement";

let n = 0;
function row(over: Partial<TakeoffRowInput>): TakeoffRowInput {
  n++;
  return { id: `m${n}`, planSheetId: "A10", sheetNumber: "A-10", metricKey: "roof.area", label: `Row ${n}`, valueRaw: 100, attributes: null, origin: "AI", reviewStatus: "APPROVED", ...over };
}

describe("parseSlope", () => {
  it("reads inches per foot as a rise per 12", () => {
    expect(parseSlope('1/4" PER FT')).toBe(0.25);
    expect(parseSlope('SLOPE 1/8":12"')).toBe(0.125);
    expect(parseSlope("1/2 in/ft")).toBe(0.5);
    expect(parseSlope("1-1/2\" per foot")).toBe(1.5);
    // as the 3310 set writes them
    expect(parseSlope(`1/4" / 1'-0"`)).toBe(0.25);
    expect(parseSlope(`1 3/4" / 1'-0"`)).toBe(1.75);
    expect(parseSlope(`3/8" / 1'-0" and 1/4" / 1'-0" (multiple)`)).toBe(0.375);
  });
  it("reads pitches and percentages", () => {
    expect(parseSlope("4/12")).toBe(4);
    expect(parseSlope("6:12 PITCH")).toBe(6);
    expect(parseSlope("2%")).toBeCloseTo(0.24);
  });
  it("says nothing when the text gives no slope", () => {
    expect(parseSlope("TPO MEMBRANE")).toBeNull();
    expect(parseSlope(null)).toBeNull();
  });
});

describe("bands and slope", () => {
  it("never rounds a low-slope rise into a steep band", () => {
    expect(bandOf(0.25)).toBe("0/12");
    expect(bandOf(1.9)).toBe("1/12");
    expect(bandOf(5.6)).toBe("6/12");
  });
  it("grows a plan area by its pitch", () => {
    expect(slopedArea(1000, 0)).toBe(1000);
    expect(slopedArea(1000, 12)).toBeCloseTo(1414.21, 1);
  });
});

describe("takeoffToMeasurement", () => {
  it("counts reviewed rows and hand-drawn rows, never unreviewed AI proposals", () => {
    const r = takeoffToMeasurement(
      [
        row({ valueRaw: 2000, attributes: { slope: '1/4" PER FT' } }),
        row({ valueRaw: 500, origin: "MANUAL", reviewStatus: "AI_GENERATED" }),
        row({ valueRaw: 900, reviewStatus: "AI_GENERATED" }),
        row({ valueRaw: 300, reviewStatus: "EXCLUDED" }),
        row({ metricKey: "roof.parapet", valueRaw: 218, reviewStatus: "REVIEWED" }),
        row({ metricKey: "roof.wall", valueRaw: 12, reviewStatus: "MODIFIED" }),
      ],
      { sheetIds: ["A10"], defaultRise: 0 },
    );
    expect(r.values.roofAreaSqFt).toBeCloseTo(2500, 0);
    expect(r.values.flatAreaSqFt).toBe(r.values.roofAreaSqFt);
    expect(r.values.pitchedAreaSqFt).toBe(0);
    expect(r.values.flashingLf).toBe(230);
    expect(r.pitchBands).toEqual([{ pitch: "0/12", areaSqFt: expect.closeTo(2500, 0) }]);
    expect(r.leftOut.map((l) => l.reason).sort()).toEqual(["excluded", "not_reviewed"]);
    expect(r.counted).toBe(4);
  });

  it("leaves a field null when nothing measured it", () => {
    const r = takeoffToMeasurement([row({ valueRaw: 1000 })], { sheetIds: ["A10"], defaultRise: 0 });
    expect(r.values.eavesLf).toBeUndefined();
    expect(r.values.penetrations).toBeUndefined();
    const empty = takeoffToMeasurement([], { sheetIds: ["A10"], defaultRise: 0 });
    expect(empty.pitchBands).toBeNull();
    expect(empty.values.totalSquares).toBeUndefined();
    expect(empty.warnings).toContain("No reviewed roof area on the chosen sheets.");
  });

  it("counts only the chosen sheets and warns when two carry roof area", () => {
    const rows = [row({ valueRaw: 2800 }), row({ planSheetId: "A08", sheetNumber: "A-08", valueRaw: 1500 }), row({ planSheetId: "A09", sheetNumber: "A-09", valueRaw: 1300 })];
    const one = takeoffToMeasurement(rows, { sheetIds: ["A10"], defaultRise: 0 });
    expect(one.values.roofAreaSqFt).toBe(2800);
    expect(one.warnings.some((w) => w.includes("sheets"))).toBe(false);
    const all = takeoffToMeasurement(rows, { sheetIds: ["A10", "A08", "A09"], defaultRise: 0 });
    expect(all.values.roofAreaSqFt).toBe(5600);
    expect(all.warnings[0]).toMatch(/3 sheets \(A-10, A-08, A-09\)/);
  });

  it("puts an unsloped area at the person's pitch, sloped", () => {
    const r = takeoffToMeasurement([row({ valueRaw: 1000 }), row({ valueRaw: 400, attributes: { slope: "4/12" } })], { sheetIds: ["A10"], defaultRise: 6 });
    expect(r.pitchBands).toEqual([
      { pitch: "4/12", areaSqFt: 421.64 },
      { pitch: "6/12", areaSqFt: 1118.03 },
    ]);
    expect(r.values.predominantPitch).toBe("6/12");
    expect(r.values.flatAreaSqFt).toBe(0);
    expect(r.values.totalSquares).toBe(15.4);
    expect(r.warnings.some((w) => w.includes("1 area has no slope"))).toBe(true);
  });

  it("sums counts and lists what no rule prices", () => {
    const r = takeoffToMeasurement(
      [row({ valueRaw: 1000 }), row({ metricKey: "roof.vent", valueRaw: 3 }), row({ metricKey: "roof.curb", valueRaw: 2 }), row({ metricKey: "roof.drain", valueRaw: 7 }), row({ metricKey: "roof.scupper", valueRaw: 2 })],
      { sheetIds: ["A10"], defaultRise: 0 },
    );
    expect(r.values.penetrations).toBe(5);
    expect(r.notPriced).toEqual([
      { label: "Primary drains", value: 7, unit: "EA" },
      { label: "Scuppers", value: 2, unit: "EA" },
    ]);
  });

  it("reports the share of rows a person has looked at", () => {
    const r = takeoffToMeasurement([row({}), row({ reviewStatus: "AI_GENERATED" }), row({ reviewStatus: "EXCLUDED" })], { sheetIds: ["A10"], defaultRise: 0 });
    expect(r.reviewedShare).toBe(0.5);
  });
});
