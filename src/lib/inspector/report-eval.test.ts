import { describe, expect, it } from "vitest";
import { boxOnPrint, buildReport, DISCLAIMER, printSize, reportFileName, reportPhotoIds, type ReportFindingIn, type ReportInput } from "./report";
import { matchItems, scoreCase, totals, type EvalItem, type TruthItem } from "./eval";

const finding = (over: Partial<ReportFindingIn>): ReportFindingIn => ({
  id: "f",
  areaId: "a1",
  photoId: "p1",
  title: "Paint drips on door casing",
  evidence: "Drips visible",
  action: "Sand and repaint",
  physicalCheck: null,
  severity: "MINOR",
  tradeLabel: "Painting",
  boxes: [{ x1: 10, y1: 10, x2: 50, y2: 50 }],
  review: "CONFIRMED",
  resolved: false,
  punch: null,
  source: "AI",
  ...over,
});

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  number: "INS-00007",
  kindLabel: "Completion",
  status: "OPEN",
  title: null,
  place: "2188 Wind Trace Rd",
  jobCode: "JOB-00022",
  contractor: "BNW",
  qualityLabel: "Retail",
  startedBy: "Richard Carey",
  createdAt: new Date("2026-11-25T15:00:00Z"),
  acceptedAt: null,
  acceptedBy: null,
  acceptOverride: null,
  areas: [
    { id: "a1", name: "Kitchen", tradeLabel: "Cabinets", photoCount: 2 },
    { id: "a2", name: "Bath", tradeLabel: null, photoCount: 1 },
  ],
  photos: [
    { id: "p1", areaId: "a1", width: 2000, height: 1500 },
    { id: "p2", areaId: "a1", width: 2000, height: 1500 },
    { id: "p3", areaId: "a2", width: 1500, height: 2000 },
  ],
  findings: [],
  toReview: 0,
  ...over,
});

describe("buildReport", () => {
  it("prints confirmed findings only — never proposed or dismissed", () => {
    const m = buildReport(input({
      findings: [
        finding({ id: "1", review: "CONFIRMED" }),
        finding({ id: "2", review: "PROPOSED", title: "Maybe a crack" }),
        finding({ id: "3", review: "DISMISSED", title: "Shadow" }),
      ],
      toReview: 1,
    }));
    const titles = m.areas.flatMap((a) => [...a.photos.flatMap((p) => p.findings), ...a.unplaced]).map((f) => f.title);
    expect(titles).toEqual(["Paint drips on door casing"]);
    expect(m.totals.findings).toBe(1);
    expect(m.toReview).toBe(1);
    expect(m.disclaimer).toBe(DISCLAIMER);
  });

  it("groups by photo, worst first, numbering in print order", () => {
    const m = buildReport(input({
      findings: [
        finding({ id: "1", photoId: "p2", severity: "COSMETIC", title: "Scuff" }),
        finding({ id: "2", photoId: "p1", severity: "CRITICAL", title: "Open junction box" }),
        finding({ id: "3", photoId: "p1", severity: "MINOR", title: "Gap at backsplash" }),
        finding({ id: "4", photoId: null, areaId: "a2", severity: "MAJOR", title: "Tub not level", boxes: [] }),
      ],
    }));
    const kitchen = m.areas[0];
    expect(kitchen.photos.map((p) => p.photoId)).toEqual(["p1", "p2"]);
    expect(kitchen.photos[0].findings.map((f) => [f.n, f.title])).toEqual([[1, "Open junction box"], [2, "Gap at backsplash"]]);
    expect(kitchen.photos[1].findings[0].n).toBe(3);
    expect(m.areas[1].unplaced[0]).toMatchObject({ n: 4, title: "Tub not level" });
    expect(reportPhotoIds(m)).toEqual(["p1", "p2"]);
    expect(m.totals.bySeverity.map((s) => s.severity)).toEqual(["CRITICAL", "MAJOR", "MINOR", "COSMETIC"]);
  });

  it("states each finding's status and the totals", () => {
    const m = buildReport(input({
      findings: [
        finding({ id: "1", resolved: true }),
        finding({ id: "2", punch: { status: "OPEN" }, title: "B" }),
        finding({ id: "3", punch: { status: "CANCELLED" }, title: "C" }),
        finding({ id: "4", source: "PERSON", title: "D" }),
      ],
    }));
    const all = m.areas[0].photos[0].findings;
    expect(all.map((f) => f.status)).toEqual(["Fixed", "Punch item open", "Open", "Open"]);
    expect(all[3].addedByPerson).toBe(true);
    expect(m.totals).toMatchObject({ findings: 4, open: 3, fixed: 1 });
  });

  it("an area with nothing found is listed; findings on an unknown area go under General", () => {
    const m = buildReport(input({ findings: [finding({ id: "1", areaId: null, photoId: null, boxes: [] })] }));
    expect(m.areas.map((a) => a.name)).toEqual(["Kitchen", "Bath", "General"]);
    expect(m.areas[0].photos).toHaveLength(0);
  });

  it("draft while open; accepted with the person and any override; closed", () => {
    expect(buildReport(input()).draft).toBe(true);
    const acc = buildReport(input({ status: "ACCEPTED", acceptedAt: new Date("2026-11-26T15:00:00Z"), acceptedBy: "Richard Carey", acceptOverride: "Owner moving in", toReview: 3 }));
    expect(acc.draft).toBe(false);
    expect(acc.statusLine).toBe("Work accepted by Richard Carey on November 26, 2026 with open items");
    expect(acc.acceptOverride).toBe("Owner moving in");
    expect(acc.toReview).toBe(0);
    expect(buildReport(input({ status: "CLOSED" })).statusLine).toBe("Closed without acceptance");
  });

  it("title falls back to kind and place; file name is safe", () => {
    const m = buildReport(input());
    expect(m.title).toBe("Completion — 2188 Wind Trace Rd");
    expect(reportFileName(m)).toBe("INS-00007-2188-Wind-Trace-Rd.pdf");
    expect(reportFileName({ number: "INS-00001", place: "" })).toBe("INS-00001.pdf");
  });
});

describe("print geometry", () => {
  it("fits the photo keeping its shape", () => {
    expect(printSize({ width: 2000, height: 1500 }, 320, 260)).toEqual({ width: 320, height: 240 });
    expect(printSize({ width: 1500, height: 2000 }, 320, 260)).toEqual({ width: 195, height: 260 });
  });
  it("scales and clamps a box onto the print", () => {
    expect(boxOnPrint({ x1: 1000, y1: 750, x2: 1500, y2: 1125 }, { width: 2000, height: 1500 }, { width: 320, height: 240 })).toEqual({ left: 160, top: 120, width: 80, height: 60 });
    expect(boxOnPrint({ x1: 1900, y1: 0, x2: 2400, y2: 100 }, { width: 2000, height: 1500 }, { width: 200, height: 150 })).toEqual({ left: 190, top: 0, width: 10, height: 10 });
  });
});

const item = (over: Partial<EvalItem>): EvalItem => ({ photo: "p1", title: "Paint drips on door casing", severity: "MINOR", trade: "painting", box: { x1: 100, y1: 100, x2: 300, y2: 300 }, ...over });
const truthItem = (over: Partial<TruthItem>): TruthItem => ({ ...item(over), source: "AI", ...over });

describe("eval matching", () => {
  it("overlapping boxes on the same photo match even with other words", () => {
    const r = matchItems([item({})], [item({ title: "Drip marks on trim", box: { x1: 120, y1: 110, x2: 310, y2: 290 } })]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].iou).toBeGreaterThan(0.7);
  });

  it("a different photo never matches; an 'also in' photo does", () => {
    expect(matchItems([item({})], [item({ photo: "p2" })]).pairs).toHaveLength(0);
    expect(matchItems([item({})], [item({ photo: "p2", also: ["p1"], box: null })]).pairs).toHaveLength(1);
  });

  it("far-apart boxes with unrelated titles do not match", () => {
    const r = matchItems([item({})], [item({ title: "Cracked tile at tub", trade: "tile", box: { x1: 1500, y1: 1000, x2: 1700, y2: 1200 } })]);
    expect(r.pairs).toHaveLength(0);
    expect(r.missed).toEqual([0]);
    expect(r.extra).toEqual([0]);
  });

  it("one-to-one: the closer prediction wins, the other is a false alarm", () => {
    const r = matchItems([item({})], [item({ title: "Paint drips", box: { x1: 600, y1: 600, x2: 700, y2: 700 } }), item({ box: { x1: 105, y1: 100, x2: 300, y2: 300 } })]);
    expect(r.pairs).toEqual([expect.objectContaining({ truth: 0, pred: 1 })]);
    expect(r.extra).toEqual([0]);
  });
});

describe("eval scoring", () => {
  it("counts hits, misses, false alarms, repeats, boxes and severity", () => {
    const truth = [truthItem({}), truthItem({ title: "Missing outlet cover", trade: "electrical", severity: "MAJOR", box: { x1: 1000, y1: 200, x2: 1100, y2: 320 }, source: "PERSON" })];
    const dismissed = [item({ title: "Shadow on wall", box: { x1: 1500, y1: 1000, x2: 1700, y2: 1200 } })];
    const preds = [
      item({ severity: "MAJOR", box: { x1: 180, y1: 180, x2: 360, y2: 360 } }),
      item({ title: "Dark stain on wall", trade: "drywall", box: { x1: 1510, y1: 1010, x2: 1690, y2: 1190 } }),
    ];
    const s = scoreCase(truth, dismissed, preds);
    expect(s).toMatchObject({ truth: 2, predicted: 2, tp: 1, fp: 1, fn: 1, repeatedFalseAlarms: 1, boxPairs: 1, severityExact: 0, severityWithinOne: 1 });
    expect(s.boxHits).toBe(0); // IoU of those two boxes is under 0.3
    expect(s.byTrade).toEqual({ painting: { tp: 1, fp: 0, fn: 0 }, electrical: { tp: 0, fp: 0, fn: 1 }, drywall: { tp: 0, fp: 1, fn: 0 } });
  });

  it("totals: precision, recall, F1 and per trade; nothing to judge is null, not 0", () => {
    const a = scoreCase([truthItem({})], [], [item({})]);
    const b = scoreCase([truthItem({ trade: "tile", title: "Lippage", box: null })], [], []);
    const t = totals([a, b]);
    expect(t).toMatchObject({ cases: 2, tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5, boxHitRate: 1, severityExact: 1 });
    expect(t.f1).toBeCloseTo(2 / 3);
    expect(t.byTrade.find((x) => x.trade === "tile")).toMatchObject({ tp: 0, fn: 1, recall: 0, precision: null });
    expect(totals([]).precision).toBeNull();
  });
});
