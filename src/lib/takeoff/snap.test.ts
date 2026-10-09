import { describe, expect, it } from "vitest";
import { chainsToSegments, SnapIndex } from "./snap";

describe("snap index", () => {
  it("finds the same answer as brute force and prefers vertices, then endpoints, then segments", () => {
    const segs = Array.from({ length: 4000 }, (_, i) => { const x = (i * 37) % 2000, y = (i * 91) % 1500; return { x1: x, y1: y, x2: x + 40, y2: y + (i % 3 ? 0 : 25) }; });
    const idx = new SnapIndex(segs);
    expect(idx.size).toBe(4000);
    let agree = 0;
    for (let k = 0; k < 200; k++) {
      const p = { x: (k * 173) % 2000, y: (k * 131) % 1500 };
      const got = idx.snap(p, 8, 5);
      let bestD = Infinity, best: { x: number; y: number } | null = null;
      for (const s of segs) for (const e of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d <= 8 && d < bestD) { bestD = d; best = e; } }
      if (best) { if (got && got.kind === "endpoint" && Math.abs(got.point.x - best.x) < 1e-9 && Math.abs(got.point.y - best.y) < 1e-9) agree++; }
      else if (!got || got.kind === "segment") agree++;
    }
    expect(agree).toBe(200);
    expect(idx.snap({ x: 2, y: 2 }, 8, 5, [{ x: 1, y: 1 }])).toEqual({ point: { x: 1, y: 1 }, kind: "vertex" });
    expect(idx.snap({ x: 5000, y: 5000 }, 8, 5)).toBeNull();
  });
  it("reads the segments route's rows", () => {
    expect(chainsToSegments([[1, 2, 3, 4, 2.8, 0.5]])).toEqual([{ x1: 1, y1: 2, x2: 3, y2: 4 }]);
  });
});
