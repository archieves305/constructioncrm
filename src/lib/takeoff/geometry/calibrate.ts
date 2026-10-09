import type { Pt } from "../geometry";
import { parseScaleText } from "../sheets/scale";
import type { TextItem } from "../types";
import { findDimensionStrings, type DimensionString } from "./dimensions";

/** A straight drawn line with an id: a raw segment (not a chain — chains merge the adjacent dimension lines of a string). */
export type Line = { id: string; x1: number; y1: number; x2: number; y2: number; len: number };

/**
 * Proving a sheet's scale. The printed scale is a claim (PDFs get resized
 * and cropped); the dimension strings drawn on the sheet are facts, each
 * sitting on a dimension line of a measurable length. Match strings to
 * lines, take the median points-per-foot, and compare with the printed
 * value: agreement within a few percent across several dimensions is a
 * verified calibration. Measured on A-10 of the test set: 0–2 % off the
 * printed 18 pt/ft on every matched dimension.
 */
export type DimensionMatch = { itemId: string; text: string; feet: number; lineId: string; lengthPt: number; ptPerFt: number };

export type Verification = {
  printedPtPerFt: number | null;
  matches: DimensionMatch[];
  /** Matches thrown out as mis-matches (a neighbouring line picked up). */
  dropped: number;
  medianPtPerFt: number | null;
  /** Spread of the matched ratios around the median, as a fraction. */
  spread: number | null;
  /** Median ÷ printed − 1, when both exist. */
  deviation: number | null;
  verdict: "VERIFIED" | "PRINTED_ONLY" | "DISAGREES" | "NONE";
};

/**
 * A dimension string and the line it labels: a straight line roughly centred
 * under (or beside) the text, long enough to carry it, the longest such line
 * — the short ones nearby are tick marks and extension lines.
 */
export function matchDimensionLines(dims: readonly DimensionString[], lines: readonly Line[], opts: { maxOffset?: number; maxCentreGap?: number } = {}): DimensionMatch[] {
  const { maxOffset = 20, maxCentreGap = 30 } = opts;
  const out: DimensionMatch[] = [];
  for (const d of dims) {
    const cx = d.x + d.w / 2, cy = d.y - d.h / 2;
    let best: Line | null = null;
    for (const c of lines) {
      if (c.len < d.w * 1.5) continue;
      const horizontal = Math.abs(c.y1 - c.y2) < 0.5;
      const vertical = Math.abs(c.x1 - c.x2) < 0.5;
      if (!horizontal && !vertical) continue;
      const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
      const offset = horizontal ? Math.abs(c.y1 - cy) : Math.abs(c.x1 - cx);
      const along = horizontal ? Math.abs(mx - cx) : Math.abs(my - cy);
      if (offset > maxOffset || along > maxCentreGap) continue;
      if (!best || c.len > best.len) best = c;
    }
    if (best) out.push({ itemId: d.itemId, text: d.text, feet: d.feet, lineId: best.id, lengthPt: best.len, ptPerFt: round4(best.len / d.feet) });
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const MAX_SPREAD = 0.06;
export const MAX_DEVIATION = 0.03;

/** Keep the matches whose ratio sits within `tol` of the median, twice over, so one mis-matched line cannot move the verdict. */
function dropOutliers(matches: DimensionMatch[], tol = 0.05): { kept: DimensionMatch[]; dropped: number } {
  let kept = matches;
  for (let pass = 0; pass < 2; pass++) {
    const med = median(kept.map((m) => m.ptPerFt));
    if (!med) break;
    kept = kept.filter((m) => Math.abs(m.ptPerFt / med - 1) <= tol);
  }
  return { kept, dropped: matches.length - kept.length };
}

/** Verify a printed scale against the dimensions, or derive one from them when nothing is printed. */
export function verifyScale(scaleText: string | null, items: readonly TextItem[], lines: readonly (Line | Omit<Line, "id">)[]): Verification {
  const printed = scaleText ? parseScaleText(scaleText) : null;
  const printedPtPerFt = printed && !printed.nts ? printed.ptPerFt : null;
  const dims = findDimensionStrings(items);
  const withIds: Line[] = lines.map((l, i) => ("id" in l && l.id ? (l as Line) : { ...l, id: `s${i}` }));
  const all = matchDimensionLines(dims, withIds);
  const { kept: matches, dropped } = dropOutliers(all);
  const med = median(matches.map((m) => m.ptPerFt));
  const spread = med && matches.length ? round4(Math.max(...matches.map((m) => Math.abs(m.ptPerFt / med - 1)))) : null;
  const deviation = med && printedPtPerFt ? round4(med / printedPtPerFt - 1) : null;
  const enough = matches.length >= 3 && matches.length >= all.length / 2;
  // Dimension lines overshoot their ticks by a few points, so matched ratios
  // scatter up to ~6 % even on a true-to-scale sheet; the median is what the
  // sheet agrees on. VERIFIED: enough matches, scattered no more than 6 %,
  // median within 3 % of the printed value.
  let verdict: Verification["verdict"] = "NONE";
  if (printedPtPerFt && enough && spread !== null && spread <= MAX_SPREAD && deviation !== null && Math.abs(deviation) <= MAX_DEVIATION) verdict = "VERIFIED";
  else if (printedPtPerFt && enough && deviation !== null && Math.abs(deviation) > MAX_DEVIATION) verdict = "DISAGREES";
  else if (printedPtPerFt) verdict = "PRINTED_ONLY";
  else if (enough && spread !== null && spread <= MAX_SPREAD) verdict = "VERIFIED";
  return { printedPtPerFt, matches, dropped, medianPtPerFt: med ? round4(med) : null, spread, deviation, verdict };
}

/** The calibration a verification yields: the printed value when verified (it is what the drawing claims), the measured median when nothing was printed. */
export function calibrationFrom(v: Verification): { ptPerFt: number; source: "AUTO_VERIFIED" | "AUTO"; confidence: number } | null {
  const tight = (v.spread ?? 1) <= 0.03;
  if (v.verdict === "VERIFIED" && v.printedPtPerFt) return { ptPerFt: v.printedPtPerFt, source: "AUTO_VERIFIED", confidence: tight ? 0.95 : 0.9 };
  if (v.verdict === "VERIFIED" && v.medianPtPerFt) return { ptPerFt: v.medianPtPerFt, source: "AUTO_VERIFIED", confidence: tight ? 0.85 : 0.8 };
  if (v.verdict === "PRINTED_ONLY" && v.printedPtPerFt) return { ptPerFt: v.printedPtPerFt, source: "AUTO", confidence: 0.6 };
  if (v.verdict === "DISAGREES" && v.printedPtPerFt) return { ptPerFt: v.printedPtPerFt, source: "AUTO", confidence: 0.3 };
  return null;
}

/** Two clicks and the distance between them, as typed. */
export function manualCalibration(a: Pt, b: Pt, feet: number): number | null {
  const lengthPt = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(feet > 0) || lengthPt < 1) return null;
  return round4(lengthPt / feet);
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;
