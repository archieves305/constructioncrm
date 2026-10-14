import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PageGeometry, PageText } from "../types";
import { AI_IMAGE_MAX_PX, imageScale, PROMPT_SEGMENTS, roofCandidates } from "./candidates";
import { inputHash, stableStringify } from "./hash";
import { estimateCostUsd, usageFrom } from "./pricing";
import { buildRoofRegionsPrompt, buildRoofSpecsInput, MAX_SPEC_LINES_PER_SHEET, ROOF_REGIONS_SYSTEM, ROOF_SPECS_SYSTEM } from "./prompts";
import { RoofRegionsSchema, RoofSpecsSchema } from "./schemas";

const fixture = <T,>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, "..", "__fixtures__", name), "utf8")) as T;

describe("pricing", () => {
  it("prices Opus 5.5 at the list rate and rounds to a tenth of a cent", () => {
    expect(estimateCostUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(4);
    expect(estimateCostUsd("claude-opus-5-5", { inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0.08);
    expect(estimateCostUsd("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBe(0.2);
  });
  it("prices an unknown model at the Opus rate", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCostUsd("claude-future-9", u)).toBe(estimateCostUsd("claude-opus-5-5", u));
  });
  it("reads the SDK usage block with absent cache counters", () => {
    expect(usageFrom({ input_tokens: 12, output_tokens: 3 })).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(usageFrom({ input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 7, cache_creation_input_tokens: null })).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 7, cacheWriteTokens: 0 });
  });
});

describe("hash", () => {
  it("does not depend on key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(inputHash({ b: 1, a: 2 })).toBe(inputHash({ a: 2, b: 1 }));
    expect(inputHash({ a: 2 })).not.toBe(inputHash({ a: 3 }));
  });
});

describe("candidates", () => {
  const text = fixture<PageText>("a10.text.json");
  const geometry = fixture<PageGeometry>("a10.segments.json");
  it("keeps the labels that could name a drain, a slope or the roof", () => {
    const c = roofCandidates(text, geometry);
    expect(c.labels.length).toBeGreaterThan(5);
    expect(c.labels.some((l) => /DRAIN/i.test(l.str))).toBe(true);
    expect(c.labels.every((l) => l.id.startsWith("t"))).toBe(true);
  });
  it("gives the longest segments stable ids, longest first", () => {
    const a = roofCandidates(text, geometry).segments;
    const b = roofCandidates(text, geometry).segments;
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(1500);
    expect(a.length).toBeGreaterThan(PROMPT_SEGMENTS);
    expect(a[0].id).toBe("s0");
    for (let i = 1; i < a.length; i++) expect(a[i - 1].len).toBeGreaterThanOrEqual(a[i].len);
    expect(a.every((s) => s.len >= 30)).toBe(true);
  });
  it("handles a page with nothing extracted", () => {
    expect(roofCandidates(null, null)).toEqual({ labels: [], segments: [] });
  });
  it("scales the image under the model's limit at a whole dpi", () => {
    const s = imageScale(2524.8, 1656.24);
    expect(s.dpi).toBe(57);
    expect(s.widthPx).toBeLessThanOrEqual(AI_IMAGE_MAX_PX);
    expect(s.pxPerPt).toBeCloseTo(57 / 72, 6);
    expect(imageScale(612, 792).dpi).toBe(144);
  });
});

describe("prompts", () => {
  it("lists every line with its sheet and id, capped per sheet", () => {
    const lines = Array.from({ length: MAX_SPEC_LINES_PER_SHEET + 50 }, (_, i) => ({ id: `L${i}`, text: `line ${i}` }));
    const s = buildRoofSpecsInput([{ sheetNumber: "A-24", title: "GENERAL NOTES", lines }], { address: "3310 NE 37th St" });
    expect(s).toContain("Project: 3310 NE 37th St.");
    expect(s).toContain("=== SHEET A-24 GENERAL NOTES ===");
    expect(s).toContain("A-24:L0 line 0");
    expect(s).toContain(`A-24:L${MAX_SPEC_LINES_PER_SHEET - 1}`);
    expect(s).not.toContain(`A-24:L${MAX_SPEC_LINES_PER_SHEET} `);
  });
  it("writes the regions prompt in image pixels with the scale stated", () => {
    const p = buildRoofRegionsPrompt({
      sheetNumber: "A-10", title: "GENERAL ROOF PLAN", imageWidthPx: 1999, imageHeightPx: 1312, pxPerPt: 0.7917, ptPerFt: 18, scaleText: '1/4" = 1\'-0"',
      labels: [{ id: "t43", str: "R.D.", xPx: 100, yPx: 200 }],
      segments: [{ id: "s0", x1Px: 0, y1Px: 0, x2Px: 1999, y2Px: 0, lenFt: 140.3 }],
    });
    expect(p).toContain('sheet A-10 "GENERAL ROOF PLAN"');
    expect(p).toContain("14.251 px per foot");
    expect(p).toContain('t43 "R.D." @(100,200)');
    expect(p).toContain("s0 (0,0)-(1999,0) len=140.3ft");
  });
  it("keeps the frozen system prompts forbidding numbers and guesses", () => {
    expect(ROOF_SPECS_SYSTEM).toContain("Never guess");
    expect(ROOF_REGIONS_SYSTEM).toContain("Do NOT compute any area or length");
  });
});

describe("schemas", () => {
  it("accepts the proof-of-concept regions output", () => {
    const raw = fixture<unknown>("a10.poc-regions.json");
    const r = RoofRegionsSchema.safeParse(raw);
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.regions).toHaveLength(8); expect(r.data.drains).toHaveLength(11); }
  });
  it("refuses a polygon of two points and an unknown kind", () => {
    expect(RoofRegionsSchema.safeParse({ regions: [{ name: "x", kind: "ROOF_FIELD", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 1 }], slopeText: null, boundedBySegmentIds: [], confidence: "HIGH", evidence: "" }], parapetSegmentIds: [], drains: [], cricketCount: 0, assemblyIdentifiedOnThisSheet: false, notes: "" }).success).toBe(false);
    expect(RoofSpecsSchema.safeParse({ assembly: { type: "SHINGLES", description: "", sourceSheets: [], sourceLineIds: [] }, deck: null, insulation: null, parapetDetail: null, slopes: [], drainage: null, notSpecified: [], evidence: "" }).success).toBe(false);
  });
  it("accepts an honest 'not specified'", () => {
    expect(RoofSpecsSchema.safeParse({ assembly: null, deck: "concrete", insulation: null, parapetDetail: null, slopes: ['1/4" / 1\'-0"'], drainage: "roof drains", notSpecified: ["membrane"], evidence: "no membrane named" }).success).toBe(true);
  });
});
