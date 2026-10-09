import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PageGeometry, PageText, Segment } from "../types";
import { calibrationFrom, manualCalibration, matchDimensionLines, verifyScale } from "./calibrate";
import { findDimensionStrings, formatFeetInches, parseFeetInches } from "./dimensions";
import { confidenceFromSnapping, pointInPolygon, snapPoint, snapPolygon, toFt, toSqFt } from "./measure";
import { buildChains, snapCandidates } from "./segments";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "__fixtures__", name), "utf8"));
const A10_TEXT: PageText = fx("a10.text.json");
const A10_GEO: PageGeometry = fx("a10.segments.json");
const P02_GEO: PageGeometry = fx("p02.segments.json");

describe("feet and inches", () => {
  it("parses what architects write", () => {
    expect(parseFeetInches(`16'-8 11/16"`)).toBeCloseTo(16 + (8 + 11 / 16) / 12, 6);
    expect(parseFeetInches(`20'-0"`)).toBe(20);
    expect(parseFeetInches(`20'`)).toBe(20);
    expect(parseFeetInches(`20' 6"`)).toBe(20.5);
    expect(parseFeetInches("20.5")).toBe(20.5);
    expect(parseFeetInches(`246"`)).toBe(20.5);
    expect(parseFeetInches(`6"`)).toBe(0.5);
    expect(parseFeetInches(`3 1/2"`)).toBeCloseTo(3.5 / 12, 6);
    expect(parseFeetInches("ROOF")).toBeNull();
    expect(parseFeetInches("")).toBeNull();
    expect(parseFeetInches(`0'-0"`)).toBeNull();
  });
  it("formats back", () => {
    expect(formatFeetInches(20)).toBe(`20'-0"`);
    expect(formatFeetInches(20.5)).toBe(`20'-6"`);
    expect(formatFeetInches(16.724)).toBe(`16'-8 11/16"`);
    expect(formatFeetInches(2.9999)).toBe(`3'-0"`);
  });
  it("finds the dimension strings on the roof plan and leaves elevations alone", () => {
    const dims = findDimensionStrings(A10_TEXT.items);
    expect(dims.length).toBeGreaterThanOrEqual(40);
    expect(dims.some((d) => d.text === `16'-8 11/16"`)).toBe(true);
    expect(dims.some((d) => d.text === "33.08'")).toBe(false); // an elevation, not a dimension
  });
});

describe("chains", () => {
  it("merges dash fragments and duplicates into runs", () => {
    const { chains, unique, dots } = buildChains(P02_GEO.segments);
    expect(unique).toBeLessThan(P02_GEO.segments.length); // duplicates removed
    expect(dots).toBeGreaterThan(50); // the dotted pipe pattern
    expect(chains.length).toBeLessThan(unique);
    const main = chains.find((c) => Math.abs(c.x1 - 454) < 1 && Math.abs(c.x2 - 454) < 1 && c.len > 300);
    expect(main, "the 4\" sanitary main becomes one vertical chain").toBeTruthy();
    expect(main!.parts).toBeGreaterThan(5);
    expect(main!.lw).toBeCloseTo(0.36, 1);
  });
  it("merges a synthetic dashed line and leaves a gap wider than the tolerance", () => {
    const dash = (x: number): Segment => ({ x1: x, y1: 100, x2: x + 6, y2: 100, len: 6, lw: 0.5 });
    const segs = [0, 10, 20, 30, 40].map(dash);
    segs.push({ x1: 200, y1: 100, x2: 260, y2: 100, len: 60, lw: 0.5 });
    const { chains } = buildChains(segs);
    expect(chains.map((c) => c.len).sort((a, b) => b - a)).toEqual([60, 46]);
    expect(chains.find((c) => c.len === 46)!.parts).toBe(5);
  });
  it("keeps the longest candidates for snapping", () => {
    const { chains } = buildChains(A10_GEO.segments);
    const cands = snapCandidates(chains, 2, 100);
    expect(cands.length).toBe(100);
    expect(cands[0].len).toBeGreaterThanOrEqual(cands[99].len);
  });
});

describe("calibration", () => {
  const lines = A10_GEO.segments.map((s, i) => ({ ...s, id: `s${i}` }));
  it("matches the roof plan's dimension strings to their lines at the printed scale", () => {
    const dims = findDimensionStrings(A10_TEXT.items);
    const matches = matchDimensionLines(dims, lines);
    expect(matches.length).toBeGreaterThanOrEqual(10);
    const near18 = matches.filter((m) => Math.abs(m.ptPerFt / 18 - 1) <= 0.05);
    expect(near18.length / matches.length).toBeGreaterThan(0.6);
  });
  it("verifies the printed 1/4\" scale against the drawn dimensions", () => {
    const v = verifyScale(`1/4" = 1'-0"`, A10_TEXT.items, lines);
    expect(v.printedPtPerFt).toBe(18);
    expect(v.verdict).toBe("VERIFIED");
    expect(Math.abs(v.deviation!)).toBeLessThanOrEqual(0.03);
    expect(v.spread!).toBeLessThanOrEqual(0.06);
    expect(v.matches.length).toBeGreaterThanOrEqual(30);
    expect(calibrationFrom(v)).toMatchObject({ ptPerFt: 18, source: "AUTO_VERIFIED" });
  });
  it("flags a printed scale the dimensions disagree with, and derives one when nothing is printed", () => {
    const wrong = verifyScale(`1/8" = 1'-0"`, A10_TEXT.items, lines);
    expect(wrong.verdict).toBe("DISAGREES");
    expect(calibrationFrom(wrong)).toMatchObject({ ptPerFt: 9, source: "AUTO", confidence: 0.3 });
    const none = verifyScale(null, A10_TEXT.items, lines);
    expect(none.verdict).toBe("VERIFIED");
    expect(calibrationFrom(none)!.ptPerFt).toBeCloseTo(18, 0);
    expect(calibrationFrom(none)!.source).toBe("AUTO_VERIFIED");
    expect(verifyScale("NTS", [], []).verdict).toBe("NONE");
    expect(verifyScale(`1/4" = 1'-0"`, [], []).verdict).toBe("PRINTED_ONLY");
  });
  it("takes two clicks and a distance", () => {
    expect(manualCalibration({ x: 100, y: 100 }, { x: 460, y: 100 }, 20)).toBe(18);
    expect(manualCalibration({ x: 100, y: 100 }, { x: 100, y: 100 }, 20)).toBeNull();
    expect(manualCalibration({ x: 0, y: 0 }, { x: 36, y: 0 }, 0)).toBeNull();
  });
});

describe("measuring and snapping", () => {
  it("converts at the calibration", () => {
    expect(toSqFt(324, 18)).toBe(1);
    expect(toFt(36, 18)).toBe(2);
  });
  it("tests points against a polygon", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(pointInPolygon({ x: 10, y: 5 }, sq)).toBe(true);
  });
  it("snaps to an endpoint first, then onto a segment, else stays put", () => {
    const segs = [{ x1: 0, y1: 0, x2: 100, y2: 0 }];
    expect(snapPoint({ x: 3, y: 2 }, segs, 5, 3)).toMatchObject({ point: { x: 0, y: 0 }, kind: "endpoint" });
    expect(snapPoint({ x: 50, y: 2 }, segs, 5, 3)).toMatchObject({ point: { x: 50, y: 0 }, kind: "segment" });
    expect(snapPoint({ x: 50, y: 20 }, segs, 5, 3)).toMatchObject({ point: { x: 50, y: 20 }, snapped: false });
    const poly = snapPolygon([{ x: 1, y: 1 }, { x: 99, y: -1 }, { x: 50, y: 40 }], segs, 5, 3);
    expect(poly.snapped).toBe(2);
    expect(confidenceFromSnapping(2, 3)).toBe("LOW");
    expect(confidenceFromSnapping(8, 10)).toBe("MEDIUM");
    expect(confidenceFromSnapping(36, 36)).toBe("HIGH");
  });
});
