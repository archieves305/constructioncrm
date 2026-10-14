import type { RoofRegionsOutput } from "../ai/schemas";
import type { CandidateLabel, CandidateSegment } from "../ai/candidates";
import type { Pt } from "../geometry";
import { confidenceFromSnapping, polygonArea, polylineLength, snapPolygon, type SegLike } from "../geometry/measure";
import type { MeasurementKindName } from "../metrics";

/**
 * From what the model labelled on a roof plan to the measurements code can
 * stand behind. Pure. Polygons come back in image pixels and are snapped to
 * the drawn line endpoints; parapet runs are the chosen segments joined end
 * to end; drains are points at their labels. The value of every row is
 * computed later by `computeValue` at the sheet's calibration, exactly as a
 * hand-drawn row is.
 */
export type AiMeasurementInput = {
  kind: MeasurementKindName;
  metricKey: string;
  label: string;
  attributes?: Record<string, string | number | boolean | null>;
  geometry: { points: Pt[] };
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: Record<string, unknown>;
};

export type RegionsContext = {
  pxPerPt: number;
  ptPerFt: number;
  labels: readonly CandidateLabel[];
  segments: readonly CandidateSegment[];
  /** Every drawn line of the sheet worth snapping to (the candidates at least). */
  snapSegments: readonly SegLike[];
};

export type RegionsSummary = {
  fields: number;
  fieldSf: number;
  crickets: number;
  parapetRows: number;
  parapetLf: number;
  drains: number;
  overflows: number;
  scuppers: number;
  skippedRegions: number;
  unknownSegmentIds: number;
  unknownTextIds: number;
};

export const SNAP_ENDPOINT_PT = 10;
export const SNAP_SEGMENT_PT = 6;
/** Two parapet segments whose ends sit this close are one run. */
export const JOIN_TOL_PT = 2;

const DRAIN_METRIC = { PRIMARY: "roof.drain", EMERGENCY_OVERFLOW: "roof.overflow", SCUPPER: "roof.scupper" } as const;
const DRAIN_LABEL = { PRIMARY: "Primary drain", EMERGENCY_OVERFLOW: "Overflow drain", SCUPPER: "Scupper" } as const;
const DRAIN_TAG = { PRIMARY: "RD", EMERGENCY_OVERFLOW: "OD", SCUPPER: "SC" } as const;

const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/** Join segments end to end into polylines; a segment with no neighbour is a run of its own. */
export function joinSegments(segments: readonly SegLike[], tol = JOIN_TOL_PT): Pt[][] {
  const left = segments.map((s) => ({ a: { x: s.x1, y: s.y1 }, b: { x: s.x2, y: s.y2 } }));
  const runs: Pt[][] = [];
  while (left.length) {
    const first = left.shift()!;
    const run: Pt[] = [first.a, first.b];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i];
        const head = run[0], tail = run[run.length - 1];
        if (near(tail, s.a, tol)) { run.push(s.b); left.splice(i, 1); grew = true; break; }
        if (near(tail, s.b, tol)) { run.push(s.a); left.splice(i, 1); grew = true; break; }
        if (near(head, s.b, tol)) { run.unshift(s.a); left.splice(i, 1); grew = true; break; }
        if (near(head, s.a, tol)) { run.unshift(s.b); left.splice(i, 1); grew = true; break; }
      }
    }
    runs.push(run);
  }
  return runs;
}

/** A wall drawn as two faces up to 8" apart at 1/4" scale, each face often twice. */
export const PARAPET_OFFSET_PT = 12;
export const PARAPET_ANGLE_COS = Math.cos((3 * Math.PI) / 180);
/** Pieces of a wall that meet at a corner may sit on faces this far apart. */
export const PARAPET_JOIN_PT = 14;

const segLen = (s: SegLike) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/**
 * The named parapet lines as one line per wall: segments that are parallel
 * and within the offset of a longer one (the other face of the same wall, or
 * a duplicate of it) are projected onto it and their extents united, so a
 * wall drawn four times counts once. Collinear walls that do not touch stay
 * separate pieces.
 */
export function mergeParallel(segments: readonly SegLike[], offsetTol = PARAPET_OFFSET_PT): SegLike[] {
  type Cluster = { ox: number; oy: number; ux: number; uy: number; spans: [number, number][] };
  const clusters: Cluster[] = [];
  const sorted = [...segments].filter((s) => segLen(s) >= 1).sort((a, b) => segLen(b) - segLen(a));
  for (const s of sorted) {
    const L = segLen(s);
    const sux = (s.x2 - s.x1) / L, suy = (s.y2 - s.y1) / L;
    let c = clusters.find((k) => {
      if (Math.abs(k.ux * sux + k.uy * suy) < PARAPET_ANGLE_COS) return false;
      const off = (x: number, y: number) => Math.abs((x - k.ox) * k.uy - (y - k.oy) * k.ux);
      return off(s.x1, s.y1) <= offsetTol && off(s.x2, s.y2) <= offsetTol;
    });
    if (!c) { c = { ox: s.x1, oy: s.y1, ux: sux, uy: suy, spans: [] }; clusters.push(c); }
    const proj = (x: number, y: number) => (x - c!.ox) * c!.ux + (y - c!.oy) * c!.uy;
    const t0 = proj(s.x1, s.y1), t1 = proj(s.x2, s.y2);
    c.spans.push(t0 <= t1 ? [t0, t1] : [t1, t0]);
  }
  const out: SegLike[] = [];
  for (const c of clusters) {
    const spans = c.spans.sort((a, b) => a[0] - b[0]);
    let cur: [number, number] | null = null;
    const flush = () => { if (cur) out.push({ x1: c.ox + c.ux * cur[0], y1: c.oy + c.uy * cur[0], x2: c.ox + c.ux * cur[1], y2: c.oy + c.uy * cur[1] }); };
    for (const sp of spans) {
      if (cur && sp[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], sp[1]);
      else { flush(); cur = [sp[0], sp[1]]; }
    }
    flush();
  }
  return out;
}

export function measurementsFromRegions(out: RoofRegionsOutput, ctx: RegionsContext, aiCallId: string | null): { measurements: AiMeasurementInput[]; summary: RegionsSummary } {
  const measurements: AiMeasurementInput[] = [];
  const summary: RegionsSummary = { fields: 0, fieldSf: 0, crickets: 0, parapetRows: 0, parapetLf: 0, drains: 0, overflows: 0, scuppers: 0, skippedRegions: 0, unknownSegmentIds: 0, unknownTextIds: 0 };
  const segById = new Map(ctx.segments.map((s) => [s.id, s]));
  const labelById = new Map(ctx.labels.map((l) => [l.id, l]));
  const toPt = (p: { x: number; y: number }): Pt => ({ x: p.x / ctx.pxPerPt, y: p.y / ctx.pxPerPt });
  const sqFt = (pts: Pt[]) => polygonArea(pts) / (ctx.ptPerFt * ctx.ptPerFt);

  for (const r of out.regions) {
    if (r.kind !== "ROOF_FIELD" && r.kind !== "CRICKET") { summary.skippedRegions++; continue; }
    const raw = r.polygonPx.map(toPt);
    const { points, snapped } = snapPolygon(raw, ctx.snapSegments, SNAP_ENDPOINT_PT, SNAP_SEGMENT_PT);
    const known = r.boundedBySegmentIds.filter((id) => segById.has(id));
    summary.unknownSegmentIds += r.boundedBySegmentIds.length - known.length;
    const area = sqFt(points);
    if (r.kind === "ROOF_FIELD") { summary.fields++; summary.fieldSf += area; } else summary.crickets++;
    measurements.push({
      kind: "AREA",
      metricKey: r.kind === "ROOF_FIELD" ? "roof.area" : "roof.cricket",
      label: r.name,
      attributes: r.slopeText ? { slope: r.slopeText } : undefined,
      geometry: { points },
      confidence: confidenceFromSnapping(snapped, points.length),
      evidence: { purpose: "roof_regions", summary: r.evidence, snapped: `${snapped}/${points.length}`, segmentIds: known, modelConfidence: r.confidence, aiCallId },
    });
  }

  const parapetSegs = out.parapetSegmentIds.map((id) => segById.get(id)).filter((s): s is CandidateSegment => !!s);
  summary.unknownSegmentIds += out.parapetSegmentIds.length - parapetSegs.length;
  const runs = joinSegments(mergeParallel(parapetSegs), PARAPET_JOIN_PT);
  runs.forEach((run, i) => {
    summary.parapetRows++;
    summary.parapetLf += polylineLength(run) / ctx.ptPerFt;
    measurements.push({
      kind: "LENGTH",
      metricKey: "roof.parapet",
      label: runs.length === 1 ? "Parapet" : `Parapet ${i + 1}`,
      geometry: { points: run },
      confidence: "HIGH",
      evidence: { purpose: "roof_regions", summary: "Drawn lines the model named as the parapet", segmentIds: out.parapetSegmentIds.filter((id) => segById.has(id)), aiCallId },
    });
  });

  for (const d of out.drains) {
    const t = labelById.get(d.textId);
    if (!t) { summary.unknownTextIds++; continue; }
    if (d.kind === "PRIMARY") summary.drains++; else if (d.kind === "EMERGENCY_OVERFLOW") summary.overflows++; else summary.scuppers++;
    measurements.push({
      kind: "COUNT",
      metricKey: DRAIN_METRIC[d.kind],
      label: d.sizeText ? `${DRAIN_LABEL[d.kind]} ${d.sizeText}` : DRAIN_LABEL[d.kind],
      attributes: { tag: DRAIN_TAG[d.kind], ...(d.sizeText ? { size: d.sizeText } : {}) },
      geometry: { points: [{ x: t.x + t.w / 2, y: t.y - t.h / 2 }] },
      confidence: "HIGH",
      evidence: { purpose: "roof_regions", summary: `Label "${t.str}"`, textItemIds: [t.id], aiCallId },
    });
  }

  summary.fieldSf = Math.round(summary.fieldSf);
  summary.parapetLf = Math.round(summary.parapetLf);
  return { measurements, summary };
}

/** One line for the job's progress and the toast. */
export function describeRegionsSummary(s: RegionsSummary): string {
  const parts = [`${s.fields} roof field${s.fields === 1 ? "" : "s"} (${s.fieldSf.toLocaleString("en-US")} SF)`];
  if (s.parapetRows) parts.push(`parapet ${s.parapetLf.toLocaleString("en-US")} LF`);
  const drains = s.drains + s.overflows + s.scuppers;
  if (drains) parts.push(`${drains} drain${drains === 1 ? "" : "s"}`);
  if (s.crickets) parts.push(`${s.crickets} cricket${s.crickets === 1 ? "" : "s"}`);
  return parts.join(", ");
}
