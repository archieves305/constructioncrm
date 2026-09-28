/**
 * Keyboard drags on a grid: which droppable is "to the right" of this one?
 *
 * Pure geometry over rectangles so it is a tested function; the dnd-kit
 * coordinate getter in `use-calendar-dnd.ts` feeds it the droppable rects and
 * scrolls the answer into view. A Week is one row (left / right), People and
 * Month are rows × columns (all four arrows), the Unscheduled rail is a tall
 * column to the left of everything.
 */

export type Rect = { left: number; top: number; width: number; height: number };
export type Direction = "left" | "right" | "up" | "down";

function center(r: Rect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * The candidate whose centre lies in `dir` from `current`'s centre, nearest
 * by a distance that penalises drifting off the axis (so ArrowRight prefers
 * the cell beside you over one diagonally away). Null when nothing is there.
 */
export function nearestInDirection(current: Rect, candidates: readonly { id: string; rect: Rect }[], dir: Direction): string | null {
  const c = center(current);
  let best: { id: string; score: number } | null = null;
  for (const cand of candidates) {
    const p = center(cand.rect);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    let primary: number;
    let secondary: number;
    if (dir === "right") [primary, secondary] = [dx, Math.abs(dy)];
    else if (dir === "left") [primary, secondary] = [-dx, Math.abs(dy)];
    else if (dir === "down") [primary, secondary] = [dy, Math.abs(dx)];
    else [primary, secondary] = [-dy, Math.abs(dx)];
    // Must actually be in that direction (more than a pixel of rounding), and
    // roughly along the axis — a tall rail far to the side is not "down".
    if (primary <= 1 || secondary > primary * 1.5) continue;
    const score = primary + secondary * 2;
    if (!best || score < best.score) best = { id: cand.id, score };
  }
  return best?.id ?? null;
}

/** The droppable under a point, else the one whose centre is closest. */
export function containerAt(point: { x: number; y: number }, candidates: readonly { id: string; rect: Rect }[]): string | null {
  for (const cand of candidates) {
    const r = cand.rect;
    if (point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height) return cand.id;
  }
  let best: { id: string; d: number } | null = null;
  for (const cand of candidates) {
    const p = center(cand.rect);
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (!best || d < best.d) best = { id: cand.id, d };
  }
  return best?.id ?? null;
}
