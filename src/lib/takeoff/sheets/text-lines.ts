import type { TextItem } from "../types";

/** A reading line: text runs sharing a baseline, left to right. */
export type TextLine = { y: number; x: number; items: TextItem[]; text: string };

/** Group runs whose baselines are within `tol` points into lines, top to bottom. */
export function linesOf(items: readonly TextItem[], tol = 3): TextLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, x: it.x, items: [it], text: "" });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0].x;
    line.text = line.items.map((i) => i.str).join(" ");
  }
  return lines;
}

/** `A-10`, `P-02`, `S-1.1`, `LV-01`, `E003`: a sheet number as drawn on title blocks and sheet lists. */
export const SHEET_ID_RE = /^[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?$/;

export function normalizeSheetNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function looksLikeSheetNumber(raw: string): boolean {
  return SHEET_ID_RE.test(normalizeSheetNumber(raw));
}

/** Runs on the same baseline as `anchor`, to its right, in reading order. */
export function runsRightOf(items: readonly TextItem[], anchor: TextItem, tol = 3): TextItem[] {
  return items.filter((i) => i.id !== anchor.id && Math.abs(i.y - anchor.y) <= tol && i.x >= anchor.x + anchor.w - 1).sort((a, b) => a.x - b.x);
}

/** Runs on the same baseline as `anchor`, to its left, nearest first. */
export function runsLeftOf(items: readonly TextItem[], anchor: TextItem, tol = 3): TextItem[] {
  return items.filter((i) => i.id !== anchor.id && Math.abs(i.y - anchor.y) <= tol && i.x + i.w <= anchor.x + 1).sort((a, b) => b.x - a.x);
}

/** Join runs left to right while the gap between neighbours stays under `maxGap` points. */
export function joinWhileClose(runs: readonly TextItem[], maxGap: number): TextItem[] {
  const kept: TextItem[] = [];
  for (const r of runs) {
    const prev = kept[kept.length - 1];
    if (prev && r.x - (prev.x + prev.w) > maxGap) break;
    kept.push(r);
  }
  return kept;
}
