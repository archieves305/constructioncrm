import type { Pt } from "../geometry";
import type { Segment } from "../types";

export { polygonArea, polylineLength } from "../geometry";

/** Square feet of an area in square sheet points at `ptPerFt`. */
export const toSqFt = (areaPt2: number, ptPerFt: number) => areaPt2 / (ptPerFt * ptPerFt);
/** Feet of a length in sheet points at `ptPerFt`. */
export const toFt = (lengthPt: number, ptPerFt: number) => lengthPt / ptPerFt;

/** Ray casting; a point on the edge counts as inside. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (distanceToSegment(p, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }) < 1e-6) return true;
    const crosses = (a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export type SegLike = { x1: number; y1: number; x2: number; y2: number };

/** Nearest point on a segment to `p`, and the distance. */
export function nearestOnSegment(p: Pt, s: SegLike): { point: Pt; distance: number; t: number } {
  const vx = s.x2 - s.x1, vy = s.y2 - s.y1;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - s.x1) * vx + (p.y - s.y1) * vy) / len2)) : 0;
  const point = { x: s.x1 + t * vx, y: s.y1 + t * vy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y), t };
}

export const distanceToSegment = (p: Pt, s: SegLike) => nearestOnSegment(p, s).distance;

export type Snap = { point: Pt; snapped: boolean; kind: "endpoint" | "segment" | null; segmentIndex: number | null; distance: number };

/**
 * Snap a point to the drawn geometry: an endpoint within `endpointTol` wins,
 * else the nearest point on a segment within `segmentTol`, else the point as
 * it was. Tolerances are in sheet points (the caller converts screen px).
 */
export function snapPoint(p: Pt, segments: readonly SegLike[], endpointTol: number, segmentTol: number): Snap {
  let best: Snap = { point: p, snapped: false, kind: null, segmentIndex: null, distance: Infinity };
  let bestEnd: Snap | null = null;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    for (const e of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= endpointTol && (!bestEnd || d < bestEnd.distance)) bestEnd = { point: e, snapped: true, kind: "endpoint", segmentIndex: i, distance: d };
    }
  }
  if (bestEnd) return bestEnd;
  for (let i = 0; i < segments.length; i++) {
    const n = nearestOnSegment(p, segments[i]);
    if (n.distance <= segmentTol && n.distance < best.distance) best = { point: n.point, snapped: true, kind: "segment", segmentIndex: i, distance: n.distance };
  }
  return best;
}

/** Snap every vertex; report how many landed on drawn geometry (the share drives confidence). */
export function snapPolygon(points: readonly Pt[], segments: readonly SegLike[], endpointTol: number, segmentTol: number): { points: Pt[]; snapped: number } {
  let snapped = 0;
  const out = points.map((p) => { const s = snapPoint(p, segments, endpointTol, segmentTol); if (s.snapped) snapped++; return s.point; });
  return { points: out, snapped };
}

/** The confidence band a snapped share earns: ≥ 90 % HIGH, ≥ 70 % MEDIUM, else LOW. */
export function confidenceFromSnapping(snapped: number, total: number): "HIGH" | "MEDIUM" | "LOW" {
  if (!total) return "LOW";
  const share = snapped / total;
  return share >= 0.9 ? "HIGH" : share >= 0.7 ? "MEDIUM" : "LOW";
}

/** Segments whose nearest point to `p` is within `r`. */
export function segmentsNear(p: Pt, segments: readonly Segment[], r: number): Segment[] {
  return segments.filter((s) => distanceToSegment(p, s) <= r);
}
