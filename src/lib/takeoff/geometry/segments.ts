import type { Segment } from "../types";

/**
 * Drawn lines as CAD exports them are not usable as they are: a pipe run is
 * hundreds of dash and dot fragments (0.04–40 pt), the same wall line is
 * repeated ten times, and a curve is chords. `buildChains` turns the raw
 * segments of a page into chains — collinear, nearly touching fragments
 * merged into one straight run — which are what snapping offers and what
 * the AI is asked to choose from (M3/M4). Measured on P-02 of the test set:
 * 21,470 segments → 5,990 chains in 24 ms; the 4" sanitary main became one
 * 897 pt chain.
 */
export type Chain = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
  /** Fragments merged into it. */
  parts: number;
  /** Heaviest stroke among its fragments. */
  lw: number;
  /** Σ fragment lengths ÷ chain length: ~1 solid, < 1 dashed, > 1 overdrawn. */
  fill: number;
};

export type ChainOptions = {
  /** Endpoints quantised to this many points before deduping. */
  quant?: number;
  /** Fragments shorter than this are dots: kept as bridges, not drawn. */
  minKeep?: number;
  /** Two collinear fragments closer than this join. */
  gapTol?: number;
  /** Perpendicular offset within which fragments count as the same line. */
  offsetTol?: number;
  /** Angle bucket width, degrees. */
  angleTolDeg?: number;
};

export function buildChains(segments: readonly Segment[], opts: ChainOptions = {}): { chains: Chain[]; unique: number; dots: number } {
  const { quant = 0.25, minKeep = 0.5, gapTol = 9, offsetTol = 1.2, angleTolDeg = 1.5 } = opts;
  const key = (s: Segment) => {
    const a = [Math.round(s.x1 / quant), Math.round(s.y1 / quant)];
    const b = [Math.round(s.x2 / quant), Math.round(s.y2 / quant)];
    const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
    return `${p[0]},${p[1]},${q[0]},${q[1]}`;
  };
  const seen = new Set<string>();
  const uniq: Segment[] = [];
  for (const s of segments) { const k = key(s); if (!seen.has(k)) { seen.add(k); uniq.push(s); } }
  let dots = 0;
  const segs: (Segment & { ang: number; rad: number })[] = [];
  for (const s of uniq) {
    if (s.len < minKeep) { dots++; continue; }
    const ang = ((Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI + 180) % 180;
    segs.push({ ...s, ang, rad: (ang * Math.PI) / 180 });
  }
  // group by angle bucket and perpendicular offset
  const groups = new Map<string, typeof segs>();
  for (const s of segs) {
    const ab = Math.round(s.ang / angleTolDeg);
    const nx = -Math.sin(s.rad), ny = Math.cos(s.rad);
    const off = Math.round((s.x1 * nx + s.y1 * ny) / offsetTol);
    const k = `${ab}|${off}`;
    const g = groups.get(k);
    if (g) g.push(s); else groups.set(k, [s]);
  }
  const chains: Chain[] = [];
  let id = 0;
  for (const g of groups.values()) {
    const rad = g[0].rad;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const nx = -dy, ny = dx;
    const off = g[0].x1 * nx + g[0].y1 * ny;
    const iv = g.map((s) => { const a = s.x1 * dx + s.y1 * dy, b = s.x2 * dx + s.y2 * dy; return { lo: Math.min(a, b), hi: Math.max(a, b), s }; }).sort((p, q) => p.lo - q.lo);
    let cur: { lo: number; hi: number; parts: Segment[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const len = cur.hi - cur.lo;
      if (len <= 0) return;
      chains.push({
        id: `c${id++}`,
        x1: round2(dx * cur.lo + nx * off), y1: round2(dy * cur.lo + ny * off),
        x2: round2(dx * cur.hi + nx * off), y2: round2(dy * cur.hi + ny * off),
        len: round2(len), parts: cur.parts.length, lw: Math.max(...cur.parts.map((p) => p.lw)),
        fill: round2(cur.parts.reduce((a, p) => a + p.len, 0) / len),
      });
    };
    for (const it of iv) {
      if (cur && it.lo - cur.hi <= gapTol) { cur.hi = Math.max(cur.hi, it.hi); cur.parts.push(it.s); }
      else { flush(); cur = { lo: it.lo, hi: it.hi, parts: [it.s] }; }
    }
    flush();
  }
  chains.sort((a, b) => b.len - a.len);
  return { chains, unique: uniq.length, dots };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The chains worth offering for snapping: at least `minLen` long, the longest first, capped. */
export function snapCandidates(chains: readonly Chain[], minLen = 2, max = 25_000): Chain[] {
  return chains.filter((c) => c.len >= minLen).slice(0, max);
}
