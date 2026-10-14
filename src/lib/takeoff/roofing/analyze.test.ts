import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RoofRegionsOutput } from "../ai/schemas";
import { describeRegionsSummary, joinSegments, measurementsFromRegions, mergeParallel } from "./analyze";

const fixture = <T,>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, "..", "__fixtures__", name), "utf8")) as T;

// The proof-of-concept run on A-10: the model's own output against the
// candidate ids it was given (longest segments first, `s{i}`), and the text
// items with `t{i}` ids. 1/4" = 1'-0" → 18 pt/ft; image 2000 px wide.
type PocText = { widthPt: number; heightPt: number; items: { id: string; str: string; x: number; y: number; w: number; h: number }[] };
type PocSeg = { id: string; x1: number; y1: number; x2: number; y2: number; len: number };
const text = fixture<PocText>("a10.poc-text.json");
const segments = fixture<PocSeg[]>("a10.poc-segments.json");
const out = fixture<RoofRegionsOutput>("a10.poc-regions.json");
const ctx = { pxPerPt: 2000 / text.widthPt, ptPerFt: 18, labels: text.items, segments, snapSegments: segments };

describe("measurementsFromRegions on the A-10 proof of concept", () => {
  const { measurements, summary } = measurementsFromRegions(out, ctx, "call-1");

  it("turns the eight fields into area rows and snaps every vertex", () => {
    const areas = measurements.filter((m) => m.kind === "AREA");
    expect(areas).toHaveLength(8);
    expect(areas.every((m) => m.metricKey === "roof.area")).toBe(true);
    expect(areas.every((m) => m.confidence === "HIGH")).toBe(true);
    for (const a of areas) expect(a.evidence.snapped).toBe(`${a.geometry.points.length}/${a.geometry.points.length}`);
    // the M0 record: 2,867 SF measured by code at 18 pt/ft
    expect(summary.fields).toBe(8);
    expect(summary.fieldSf).toBeGreaterThan(2800);
    expect(summary.fieldSf).toBeLessThan(2950);
  });

  it("counts each parapet wall once although the model named both faces and their duplicates", () => {
    const parapet = measurements.filter((m) => m.metricKey === "roof.parapet");
    expect(parapet.length).toBe(summary.parapetRows);
    expect(parapet.length).toBeGreaterThan(0);
    expect(parapet.length).toBeLessThanOrEqual(16);
    // the sixteen named segments sum to 391 LF (the M0 record); merged by wall they are 215 LF
    const raw = out.parapetSegmentIds.map((id) => segments.find((s) => s.id === id)!.len).reduce((a, b) => a + b, 0) / 18;
    expect(Math.round(raw)).toBe(391);
    expect(summary.parapetLf).toBeGreaterThan(205);
    expect(summary.parapetLf).toBeLessThan(225);
    expect(summary.unknownSegmentIds).toBe(0);
  });

  it("places each drain at its label with the kind's metric", () => {
    const counts = measurements.filter((m) => m.kind === "COUNT");
    expect(counts).toHaveLength(11);
    expect(summary.drains + summary.overflows + summary.scuppers).toBe(11);
    expect(summary.scuppers).toBe(2);
    expect(counts.every((m) => m.geometry.points.length === 1)).toBe(true);
    expect(counts.find((m) => m.metricKey === "roof.scupper")?.attributes?.tag).toBe("SC");
    expect(summary.unknownTextIds).toBe(0);
  });

  it("carries the call id and the model's own words as evidence, never a number from the model", () => {
    for (const m of measurements) {
      expect(m.evidence.aiCallId).toBe("call-1");
      expect(m.evidence.purpose).toBe("roof_regions");
      expect(m).not.toHaveProperty("valueRaw");
    }
  });

  it("describes the result in one line", () => {
    expect(describeRegionsSummary(summary)).toMatch(/^8 roof fields \(2,\d{3} SF\), parapet 2\d\d LF, 11 drains$/);
  });
});

describe("measurementsFromRegions edge cases", () => {
  it("skips regions that are not roof and counts unknown ids", () => {
    const o: RoofRegionsOutput = {
      regions: [{ name: "pad", kind: "EQUIPMENT_PAD", polygonPx: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], slopeText: null, boundedBySegmentIds: ["nope"], confidence: "LOW", evidence: "" }],
      parapetSegmentIds: ["s999999"],
      drains: [{ textId: "t999999", kind: "PRIMARY", sizeText: "4\"" }],
      cricketCount: 0, assemblyIdentifiedOnThisSheet: false, notes: "",
    };
    const r = measurementsFromRegions(o, ctx, null);
    expect(r.measurements).toHaveLength(0);
    expect(r.summary.skippedRegions).toBe(1);
    expect(r.summary.unknownSegmentIds).toBe(1);
    expect(r.summary.unknownTextIds).toBe(1);
  });

  it("lowers the confidence of a polygon that does not land on drawn lines", () => {
    const o: RoofRegionsOutput = {
      regions: [{ name: "free", kind: "ROOF_FIELD", polygonPx: [{ x: 333, y: 333 }, { x: 777, y: 333 }, { x: 777, y: 777 }, { x: 333, y: 777 }], slopeText: null, boundedBySegmentIds: [], confidence: "HIGH", evidence: "" }],
      parapetSegmentIds: [], drains: [], cricketCount: 0, assemblyIdentifiedOnThisSheet: false, notes: "",
    };
    const r = measurementsFromRegions(o, { ...ctx, snapSegments: [] }, null);
    expect(r.measurements[0].confidence).toBe("LOW");
    expect(r.measurements[0].evidence.snapped).toBe("0/4");
  });
});

describe("joinSegments", () => {
  it("chains end to end in either direction and leaves strangers alone", () => {
    const runs = joinSegments([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 10, x2: 10, y2: 0.5 }, // reversed, within 2 pt
      { x1: 50, y1: 50, x2: 60, y2: 50 },
      { x1: -10, y1: 0, x2: 0, y2: 0 }, // joins at the head
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([{ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(runs[1]).toEqual([{ x: 50, y: 50 }, { x: 60, y: 50 }]);
  });
});

describe("mergeParallel", () => {
  it("unites a wall's two faces and their duplicates into one line of the full extent", () => {
    const merged = mergeParallel([
      { x1: 100, y1: 0, x2: 500, y2: 0 },
      { x1: 100, y1: 0, x2: 500, y2: 0 }, // duplicate
      { x1: 90, y1: 9, x2: 300, y2: 9 }, // other face, 9 pt away, starts earlier
      { x1: 300, y1: 9, x2: 520, y2: 9 }, // other face, continues past the end
    ]);
    expect(merged).toHaveLength(1);
    const len = Math.hypot(merged[0].x2 - merged[0].x1, merged[0].y2 - merged[0].y1);
    expect(len).toBeCloseTo(430, 0);
  });
  it("keeps collinear walls that do not touch, and walls at an angle, apart", () => {
    const merged = mergeParallel([
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 200, y1: 0, x2: 300, y2: 0 },
      { x1: 0, y1: 0, x2: 0, y2: 100 },
      { x1: 0, y1: 40, x2: 100, y2: 40 }, // parallel but 40 pt off: another wall
    ]);
    expect(merged).toHaveLength(4);
  });
});
