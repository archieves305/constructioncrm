/**
 * Finding the blanks on a flat form, from the pixels of a rendered page.
 * Pure: a grayscale page in, numbered places to write out.
 *
 * Works the same on a form drawn as vector lines and on a scanned image: a
 * place to write is the empty band just above a horizontal line (an
 * underline, or the bottom of a table cell, split where vertical lines cross
 * it), or a small empty square (a tick box). Positions come from here, never
 * from the AI: the AI is shown the numbers and says which is which.
 */
export type Candidate = { id: number; kind: "line" | "box"; x: number; y: number; w: number; h: number };

const INK = 150;
const MAX_THICK = 5;
const MAX_PER_PAGE = 160;

type Run = { y: number; x0: number; x1: number };
type HLine = { y0: number; y1: number; x0: number; x1: number };
type VLine = { x0: number; x1: number; y0: number; y1: number };

/** Inches to pixels at the render's resolution. */
const px = (inches: number, dpi: number) => Math.round(inches * dpi);

function horizontalRuns(g: Uint8Array, w: number, h: number, minLen: number, maxLen = Infinity): Run[] {
  const out: Run[] = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    const row = y * w;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && g[row + x] < INK;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        const len = x - start;
        if (len >= minLen && len <= maxLen) out.push({ y, x0: start, x1: x - 1 });
        start = -1;
      }
    }
  }
  return out;
}

/** Runs on consecutive rows that overlap become one line; thick bands (filled bars, bold text) are dropped. */
function mergeRuns(runs: Run[]): HLine[] {
  const lines: HLine[] = [];
  const open: HLine[] = [];
  for (const r of runs) {
    let hit: HLine | null = null;
    for (const l of open) {
      if (l.y1 === r.y - 1 || l.y1 === r.y) {
        const overlap = Math.min(l.x1, r.x1) - Math.max(l.x0, r.x0);
        if (overlap >= 0.8 * Math.min(l.x1 - l.x0, r.x1 - r.x0)) {
          hit = l;
          break;
        }
      }
    }
    if (hit) {
      hit.y1 = r.y;
      hit.x0 = Math.min(hit.x0, r.x0);
      hit.x1 = Math.max(hit.x1, r.x1);
    } else {
      const l = { y0: r.y, y1: r.y, x0: r.x0, x1: r.x1 };
      open.push(l);
      lines.push(l);
    }
    // lines that ended more than a row ago are closed
    for (let i = open.length - 1; i >= 0; i--) if (open[i].y1 < r.y - 1) open.splice(i, 1);
  }
  return lines.filter((l) => l.y1 - l.y0 + 1 <= MAX_THICK);
}

/**
 * A scanned underline comes out in pieces — small gaps, and a step of a pixel
 * or two where the paper sat crooked. Pieces on the same line with a small
 * gap are one line.
 */
function joinCollinear(lines: HLine[], maxGap: number): HLine[] {
  let current = lines.map((l) => ({ ...l }));
  // a middle piece joins its neighbours only once it has grown: repeat until nothing joins
  for (let pass = 0; pass < 10; pass++) {
    const sorted = [...current].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const out: HLine[] = [];
    for (const l of sorted) {
      const hit = out.find((o) => Math.abs((o.y0 + o.y1) / 2 - (l.y0 + l.y1) / 2) <= 3 && l.x0 - o.x1 <= maxGap && o.x0 - l.x1 <= maxGap);
      if (hit) {
        hit.x0 = Math.min(hit.x0, l.x0);
        hit.x1 = Math.max(hit.x1, l.x1);
        hit.y0 = Math.min(hit.y0, l.y0);
        hit.y1 = Math.max(hit.y1, l.y1);
      } else out.push({ ...l });
    }
    const done = out.length === current.length;
    current = out;
    if (done) break;
  }
  return current.filter((l) => l.y1 - l.y0 + 1 <= MAX_THICK + 3);
}

function verticalLines(g: Uint8Array, w: number, h: number, minLen: number): VLine[] {
  const runs: { x: number; y0: number; y1: number }[] = [];
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const dark = y < h && g[y * w + x] < INK;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start >= minLen) runs.push({ x, y0: start, y1: y - 1 });
        start = -1;
      }
    }
  }
  const lines: VLine[] = [];
  for (const r of runs) {
    const l = lines.find((v) => v.x1 === r.x - 1 && Math.min(v.y1, r.y1) - Math.max(v.y0, r.y0) >= 0.8 * Math.min(v.y1 - v.y0, r.y1 - r.y0));
    if (l) {
      l.x1 = r.x;
      l.y0 = Math.min(l.y0, r.y0);
      l.y1 = Math.max(l.y1, r.y1);
    } else lines.push({ x0: r.x, x1: r.x, y0: r.y0, y1: r.y1 });
  }
  return lines.filter((l) => l.x1 - l.x0 + 1 <= MAX_THICK);
}

function inkIn(g: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = Math.max(0, y0); y <= y1; y++) for (let x = Math.max(0, x0); x <= x1; x++) if (g[y * w + x] < INK) n++;
  return n;
}

/** The longest stretch of columns with no ink in the band [y0, y1]. */
function emptySpan(g: Uint8Array, w: number, x0: number, x1: number, y0: number, y1: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let x = x0; x <= x1 + 1; x++) {
    let empty = x <= x1;
    if (empty) for (let y = y0; y <= y1; y++) if (g[y * w + x] < INK) { empty = false; break; }
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) {
      if (!best || x - 1 - start > best[1] - best[0]) best = [start, x - 1];
      start = -1;
    }
  }
  return best;
}

const iou = (a: Omit<Candidate, "id" | "kind">, b: Omit<Candidate, "id" | "kind">) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/**
 * The blanks of one page: `gray` is one byte per pixel (0 black, 255 white),
 * rendered at `dpi`. Numbered in reading order, top to bottom, left to right.
 */
export function findBlanks(gray: Uint8Array, width: number, height: number, dpi = 150): Candidate[] {
  const minLine = px(0.28, dpi);
  const band = px(0.17, dpi);
  // pieces as short as a sixth of an inch are kept until joined, then measured again
  const lines = joinCollinear(mergeRuns(horizontalRuns(gray, width, height, px(0.12, dpi))), px(0.035, dpi)).filter((l) => l.x1 - l.x0 + 1 >= minLine);
  const verticals = verticalLines(gray, width, height, px(0.1, dpi));
  const found: Omit<Candidate, "id">[] = [];

  for (const l of lines) {
    // split where a vertical line crosses or meets it (table cells)
    const cuts = verticals.filter((v) => v.x0 > l.x0 + 3 && v.x1 < l.x1 - 3 && v.y0 <= l.y1 + 3 && v.y1 >= l.y0 - 3).sort((a, b) => a.x0 - b.x0);
    const pieces: [number, number][] = [];
    let from = l.x0;
    for (const c of cuts) {
      pieces.push([from, c.x0 - 1]);
      from = c.x1 + 1;
    }
    pieces.push([from, l.x1]);
    for (const [a, b] of pieces) {
      if (b - a < minLine) continue;
      // the band above stops at the next line up (a cell's top border)
      let top = l.y0 - band;
      for (const o of lines) if (o !== l && o.y1 < l.y0 && o.y1 >= top && Math.min(o.x1, b) - Math.max(o.x0, a) > 0.5 * (b - a)) top = Math.max(top, o.y1 + 2);
      const bandBottom = l.y0 - 2;
      if (bandBottom - top < px(0.07, dpi)) continue;
      const span = emptySpan(gray, width, a + 2, b - 2, Math.max(0, top), bandBottom);
      if (!span || span[1] - span[0] < minLine * 0.8) continue;
      found.push({ kind: "line", x: span[0], y: Math.max(0, top), w: span[1] - span[0] + 1, h: bandBottom - Math.max(0, top) + 1 });
    }
  }

  // tick boxes: a small square outline with an empty inside
  const lo = px(0.055, dpi);
  const hi = px(0.17, dpi);
  for (const r of horizontalRuns(gray, width, height, lo, hi)) {
    const side = r.x1 - r.x0 + 1;
    const yb = r.y + side - 1;
    if (yb >= height) continue;
    const bottom = inkIn(gray, width, r.x0, yb - 2, r.x1, yb + 2);
    if (bottom < side * 0.8) continue;
    const left = inkIn(gray, width, r.x0, r.y, r.x0 + 1, yb);
    const right = inkIn(gray, width, r.x1 - 1, r.y, r.x1, yb);
    if (left < side * 0.8 || right < side * 0.8) continue;
    const inside = inkIn(gray, width, r.x0 + 3, r.y + 3, r.x1 - 3, yb - 3);
    const area = Math.max(1, (side - 6) * (side - 6));
    if (inside / area > 0.12) continue;
    // all four corners drawn (a round letter is not), and clear space all round (a letter inside a word has neighbours)
    const corner = (x: number, y: number) => inkIn(gray, width, x - 1, y - 1, x + 1, y + 1) >= 3;
    if (!corner(r.x0 + 1, r.y + 1) || !corner(r.x1 - 1, r.y + 1) || !corner(r.x0 + 1, yb - 1) || !corner(r.x1 - 1, yb - 1)) continue;
    const g = 4;
    if (r.x0 - g < 0 || r.y - g < 0 || r.x1 + g >= width || yb + g >= height) continue;
    const ring = inkIn(gray, width, r.x0 - g, r.y - g, r.x1 + g, r.y - 2) + inkIn(gray, width, r.x0 - g, yb + 2, r.x1 + g, yb + g) + inkIn(gray, width, r.x0 - g, r.y, r.x0 - 2, yb) + inkIn(gray, width, r.x1 + 2, r.y, r.x1 + g, yb);
    if (ring > side * 0.6) continue;
    found.push({ kind: "box", x: r.x0, y: r.y, w: side, h: side });
  }

  // one candidate per place: overlapping detections (a box's two top rows, a line found twice) collapse
  const kept: Omit<Candidate, "id">[] = [];
  for (const c of found) if (!kept.some((k) => k.kind === c.kind && iou(k, c) > 0.4)) kept.push(c);
  const rowOf = (c: Omit<Candidate, "id">) => Math.round((c.y + c.h) / px(0.08, dpi));
  return kept
    .sort((a, b) => rowOf(a) - rowOf(b) || a.x - b.x)
    .slice(0, MAX_PER_PAGE)
    .map((c, i) => ({ id: i + 1, ...c }));
}

/** A candidate's box in PDF points (origin bottom-left), as the form inventory keeps rectangles. */
export function toPdfRect(c: Pick<Candidate, "x" | "y" | "w" | "h">, dpi: number, pageHeightPt: number): [number, number, number, number] {
  const k = 72 / dpi;
  return [Math.round(c.x * k * 10) / 10, Math.round((pageHeightPt - (c.y + c.h) * k) * 10) / 10, Math.round(c.w * k * 10) / 10, Math.round(c.h * k * 10) / 10];
}
