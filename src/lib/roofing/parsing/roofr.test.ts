import { describe, it, expect } from "vitest";
import { parseRoofrText } from "./roofr";

const SAMPLE = `
Roofr Measurement Report
Property Address: 123 Main St, Springfield, FL 32401
Report Date: May 1, 2026
Predominant Pitch: 6/12
Total Roof Area: 3,240 sq ft
Total Squares: 32.4
Number of Facets: 9
Eaves: 120 ft
Rakes: 86 ft
Valleys: 40 ft
Hips: 22 ft
Ridges: 48 ft
Penetrations: 6
Suggested Waste Factor: 10%
Existing Roof Type: 3-tab asphalt shingle
`;

describe("parseRoofrText", () => {
  const r = parseRoofrText(SAMPLE);

  it("extracts the property address", () => {
    expect(r.parsedAddress).toContain("123 Main St");
    expect(r.parsedAddress).toContain("FL");
  });

  it("extracts core measurements with units", () => {
    expect(r.measurements.totalSquares).toBe(32.4);
    expect(r.measurements.roofAreaSqFt).toBe(3240);
    expect(r.measurements.facets).toBe(9);
    expect(r.measurements.eavesLf).toBe(120);
    expect(r.measurements.rakesLf).toBe(86);
    expect(r.measurements.valleysLf).toBe(40);
    expect(r.measurements.penetrations).toBe(6);
  });

  it("reads pitch and waste", () => {
    expect(r.measurements.predominantPitch).toBe("6/12");
    expect(r.measurements.suggestedWastePct).toBeCloseTo(0.1, 5);
  });

  it("derives ridges/hips and drip edge", () => {
    expect(r.measurements.ridgesHipsLf).toBe(70); // 48 + 22
    expect(r.measurements.dripEdgeLf).toBe(206); // 120 + 86
  });

  it("reports high confidence for a complete report", () => {
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("bounds a run-on address when the source has no line breaks", () => {
    const runOn = parseRoofrText(
      "Property Address: 987 Sunset Boulevard, Tampa, FL 33602 Report Date: June 10, 2026 Total Squares: 41.5 Eaves: 140 ft",
    );
    expect(runOn.parsedAddress).toBe("987 Sunset Boulevard, Tampa, FL 33602");
    expect(runOn.measurements.totalSquares).toBe(41.5);
  });

  // Real Roofr "Report summary" format (ft+in lengths, area-derived squares).
  const REAL = `Report summary
5450 Garfield Road, Delray Beach, FL 33484
Total roof area 3247 sqft
Total roof facets 6 facets
Predominant pitch 5/12
Total eaves 248ft 11in
Total valleys 25ft 8in
Total hips 62ft 9in
Total ridges 76ft 11in
Total rakes 48ft 7in
Total wall flashing 38ft 10in
Total step flashing 7ft 5in
Hips + ridges 139ft 8in
Eaves + rakes 297ft 6in`;

  it("parses the real Roofr summary format (ft+in, area-derived squares)", () => {
    const r = parseRoofrText(REAL);
    expect(r.measurements.roofAreaSqFt).toBe(3247);
    expect(r.measurements.totalSquares).toBe(32.5); // 3247 / 100
    expect(r.measurements.facets).toBe(6);
    expect(r.measurements.eavesLf).toBeCloseTo(248.92, 1); // 248ft 11in
    expect(r.measurements.valleysLf).toBeCloseTo(25.67, 1);
    expect(r.measurements.ridgesHipsLf).toBeCloseTo(139.67, 1);
    expect(r.measurements.dripEdgeLf).toBeCloseTo(297.5, 1); // eaves + rakes
    expect(r.measurements.stepFlashingLf).toBeCloseTo(7.42, 1);
    expect(r.parsedAddress).toContain("5450 Garfield Road");
  });

  // 737 W Ilex: a mixed steep + flat roof. The total (2436) must split into
  // pitched (1666, drives shingle math) and flat (771, separate system).
  const MIXED = `Report summary
737 West Ilex Drive, West Palm Beach, FL 33403
Total roof area 2436 sqft
Total pitched area 1666 sqft
Total flat area 771 sqft
Total roof facets 6 facets
Predominant pitch 3/12
Total eaves 150ft 11in
Total ridges 81ft 6in
Total rakes 154ft 10in
Hips + ridges 81ft 6in
Eaves + rakes 305ft 10in
Pitch 1/12 3/12
Area (sqft) 771 1,666
Squares 7.8 16.7`;

  it("splits pitched vs flat area on a mixed roof", () => {
    const r = parseRoofrText(MIXED);
    expect(r.measurements.roofAreaSqFt).toBe(2436);
    expect(r.measurements.pitchedAreaSqFt).toBe(1666);
    expect(r.measurements.flatAreaSqFt).toBe(771);
    // Roofr rounds each line independently, so pitched + flat (2437) can differ
    // from the stated total (2436) by ~1 sqft. They should still roughly agree.
    const sum = (r.measurements.pitchedAreaSqFt ?? 0) + (r.measurements.flatAreaSqFt ?? 0);
    expect(Math.abs(sum - (r.measurements.roofAreaSqFt ?? 0))).toBeLessThanOrEqual(2);
  });

  it("parses the per-pitch area table", () => {
    const r = parseRoofrText(MIXED);
    expect(r.measurements.pitchBands).toEqual([
      { pitch: "1/12", areaSqFt: 771 },
      { pitch: "3/12", areaSqFt: 1666 },
    ]);
  });

  // 1061 NW 108th Ter: a predominantly flat roof (Roofr buckets 2/12 as flat),
  // the inverse of 737 W Ilex — a good low-slope calibration case.
  const MOSTLY_FLAT = `Report summary
1061 Northwest 108th Terrace, Miami, FL 33168
Total roof area 3155 sqft
Total pitched area 231 sqft
Total flat area 2924 sqft
Total roof facets 9 facets
Predominant pitch 2/12
Total eaves 306ft 1in
Total ridges 42ft 4in
Pitch 0/12 2/12 4/12
Area (sqft) 630 2,295 231
Squares 6.3 23.0 2.4`;

  it("splits a predominantly-flat roof (1061 NW 108th)", () => {
    const r = parseRoofrText(MOSTLY_FLAT);
    expect(r.measurements.roofAreaSqFt).toBe(3155);
    expect(r.measurements.pitchedAreaSqFt).toBe(231);
    expect(r.measurements.flatAreaSqFt).toBe(2924);
  });

  it("parses the 3-band pitch table (0/12, 2/12, 4/12)", () => {
    const r = parseRoofrText(MOSTLY_FLAT);
    expect(r.measurements.pitchBands).toEqual([
      { pitch: "0/12", areaSqFt: 630 },
      { pitch: "2/12", areaSqFt: 2295 },
      { pitch: "4/12", areaSqFt: 231 },
    ]);
  });

  it("leaves pitched/flat undefined on a report without the split", () => {
    const r = parseRoofrText(REAL);
    expect(r.measurements.pitchedAreaSqFt == null).toBe(true);
    expect(r.measurements.flatAreaSqFt == null).toBe(true);
  });

  // Multi-structure reports print per-structure blocks before the property-wide
  // "Report summary"; we must read the summary totals, not structure #1.
  const MULTI_STRUCTURE = `Pitch & direction measurement report
Total pitched area 1253 sqft
Total flat area 771 sqft
Pitch 1/12 3/12
Area (sqft) 771 1,254
Squares 7.8 12.6
Pitch & direction measurement report
Total pitched area 412 sqft
Total flat area 0 sqft
Pitch 3/12
Area (sqft) 413
Squares 4.2
Report summary
737 West Ilex Drive, West Palm Beach, FL 33403
Total roof area 2436 sqft
Total pitched area 1666 sqft
Total flat area 771 sqft
Pitch 1/12 3/12
Area (sqft) 771 1,666
Squares 7.8 16.7`;

  it("reads property-wide totals from the Report summary, not structure #1", () => {
    const r = parseRoofrText(MULTI_STRUCTURE);
    expect(r.measurements.roofAreaSqFt).toBe(2436);
    expect(r.measurements.pitchedAreaSqFt).toBe(1666); // not 1253 (structure #1)
    expect(r.measurements.flatAreaSqFt).toBe(771);
    expect(r.measurements.pitchBands).toEqual([
      { pitch: "1/12", areaSqFt: 771 },
      { pitch: "3/12", areaSqFt: 1666 }, // not 1,254 (structure #1)
    ]);
  });

  it("flags low confidence when measurements are missing", () => {
    const sparse = parseRoofrText("Some scanned document with no useful labels.");
    expect(sparse.confidence).toBeLessThan(0.7);
    expect(sparse.warnings.length).toBeGreaterThan(0);
  });
});
