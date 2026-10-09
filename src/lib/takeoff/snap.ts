import type { Pt } from "./geometry";
import { nearestOnSegment, type SegLike } from "./geometry/measure";

/**
 * A uniform grid over a sheet's chains so snapping stays instant with tens
 * of thousands of lines. Client-safe. Tolerances arrive in sheet points (the
 * viewer converts its screen-pixel radius with the current scale).
 */
export type SnapTarget = { point: Pt; kind: "vertex" | "endpoint" | "segment" };

export class SnapIndex {
  private cells = new Map<string, number[]>();
  constructor(private readonly segments: readonly SegLike[], private readonly cell = 24) {
    segments.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.x1, s.x2) / cell), x1 = Math.floor(Math.max(s.x1, s.x2) / cell);
      const y0 = Math.floor(Math.min(s.y1, s.y2) / cell), y1 = Math.floor(Math.max(s.y1, s.y2) / cell);
      // a long diagonal touches many cells; cap the fan-out per segment
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) { this.push(x0, y0, i); this.push(x1, y1, i); return; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.push(x, y, i);
    });
  }
  private push(x: number, y: number, i: number) {
    const k = `${x},${y}`;
    const c = this.cells.get(k);
    if (c) c.push(i); else this.cells.set(k, [i]);
  }
  private near(p: Pt, r: number): number[] {
    const out = new Set<number>();
    const x0 = Math.floor((p.x - r) / this.cell), x1 = Math.floor((p.x + r) / this.cell);
    const y0 = Math.floor((p.y - r) / this.cell), y1 = Math.floor((p.y + r) / this.cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const i of this.cells.get(`${x},${y}`) ?? []) out.add(i);
    return [...out];
  }
  /** Existing vertices first, then endpoints within `endpointTol`, then the nearest point on a segment within `segmentTol`. */
  snap(p: Pt, endpointTol: number, segmentTol: number, vertices: readonly Pt[] = []): SnapTarget | null {
    let best: { t: SnapTarget; d: number } | null = null;
    for (const v of vertices) { const d = Math.hypot(v.x - p.x, v.y - p.y); if (d <= endpointTol && (!best || d < best.d)) best = { t: { point: v, kind: "vertex" }, d }; }
    if (best) return best.t;
    const ids = this.near(p, Math.max(endpointTol, segmentTol));
    for (const i of ids) {
      const s = this.segments[i];
      for (const e of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d <= endpointTol && (!best || d < best.d)) best = { t: { point: e, kind: "endpoint" }, d }; }
    }
    if (best) return best.t;
    for (const i of ids) {
      const n = nearestOnSegment(p, this.segments[i]);
      if (n.distance <= segmentTol && (!best || n.distance < best.d)) best = { t: { point: n.point, kind: "segment" }, d: n.distance };
    }
    return best?.t ?? null;
  }
  get size() { return this.segments.length; }
}

/** Chains as the segments route sends them: [x1, y1, x2, y2, len, lw]. */
export function chainsToSegments(rows: readonly number[][]): SegLike[] {
  return rows.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
}
