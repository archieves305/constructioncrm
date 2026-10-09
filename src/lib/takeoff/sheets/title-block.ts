import type { TextItem } from "../types";
import { joinWhileClose, looksLikeSheetNumber, normalizeSheetNumber, runsRightOf } from "./text-lines";

export type TitleBlock = {
  sheetNumber: string | null;
  sheetNumberConfidence: number;
  title: string | null;
  titleConfidence: number;
  revisionLabel: string | null;
};

const SHEET_LABEL_RE = /^SHEET\s*(NO\.?|NUMBER|#)\s*:?$/i;
const TITLE_LABEL_RE = /^(SHEET\s*(TITLE|NAME)|TITLE|DRAWING\s*TITLE|SHEET)\s*:?$/i;
const REV_RE = /^(?:REV(?:ISION)?\.?\s*[:#]?\s*)([A-Z]|\d{1,2})$/i;

function inBlock(it: TextItem, widthPt: number, heightPt: number): boolean {
  return it.x > widthPt * 0.8 || it.y > heightPt * 0.85;
}

/**
 * The title block: the right strip or the bottom band of the page. The sheet
 * number is the sheet-like run under a "SHEET NO." label when there is one,
 * else the largest such run in the block; the title is the run after a
 * "SHEET:" label, else the largest capitalised line in the block that is not
 * the number or a company line.
 */
export function parseTitleBlock(items: readonly TextItem[], widthPt: number, heightPt: number): TitleBlock {
  const block = items.filter((i) => inBlock(i, widthPt, heightPt));
  const candidates = block.filter((i) => looksLikeSheetNumber(i.str));

  let sheetNumber: string | null = null;
  let sheetNumberConfidence = 0;
  const label = block.find((i) => SHEET_LABEL_RE.test(i.str.trim()));
  if (label) {
    // the number sits below the label (stacked) or to its right (inline)
    const below = candidates.filter((c) => c.y > label.y && c.y - label.y < 60 && Math.abs(c.x - label.x) < 120).sort((a, b) => a.y - b.y);
    const inline = runsRightOf(block, label).find((r) => looksLikeSheetNumber(r.str));
    const pick = below[0] ?? inline ?? null;
    if (pick) { sheetNumber = normalizeSheetNumber(pick.str); sheetNumberConfidence = 0.95; }
  }
  if (!sheetNumber && candidates.length) {
    const largest = [...candidates].sort((a, b) => b.h - a.h || b.y - a.y)[0];
    sheetNumber = normalizeSheetNumber(largest.str);
    sheetNumberConfidence = candidates.filter((c) => normalizeSheetNumber(c.str) === sheetNumber).length === candidates.length ? 0.8 : 0.6;
  }
  if (!sheetNumber) {
    // nothing in the block: the most frequent sheet-like run anywhere is a weak guess
    const all = items.filter((i) => looksLikeSheetNumber(i.str));
    const counts = new Map<string, number>();
    for (const a of all) counts.set(normalizeSheetNumber(a.str), (counts.get(normalizeSheetNumber(a.str)) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) { sheetNumber = best[0]; sheetNumberConfidence = 0.3; }
  }

  let title: string | null = null;
  let titleConfidence = 0;
  const titleLabel = block.find((i) => TITLE_LABEL_RE.test(i.str.trim()) && !SHEET_LABEL_RE.test(i.str.trim()));
  if (titleLabel) {
    const runs = joinWhileClose(runsRightOf(block, titleLabel), 40);
    const text = runs.map((r) => r.str).join(" ").trim();
    if (text && !looksLikeSheetNumber(text)) { title = text; titleConfidence = 0.9; }
  }
  if (!title) {
    const lines = capitalisedLines(block).filter((l) => !looksLikeSheetNumber(l.text) && l.text.length >= 6 && !/^(SHEET|PROJECT|DESIGNER|DRAWN|OWNER|ADDRESS|DATE|SCALE|REV)/i.test(l.text));
    const pick = lines.sort((a, b) => b.h - a.h)[0];
    if (pick) { title = pick.text; titleConfidence = 0.4; }
  }

  const rev = block.map((i) => i.str.trim().match(REV_RE)).find(Boolean);
  const revisionLabel = rev ? rev[1].toUpperCase() : null;

  return { sheetNumber, sheetNumberConfidence, title, titleConfidence, revisionLabel };
}

function capitalisedLines(items: readonly TextItem[]): { text: string; h: number }[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; parts: TextItem[] }[] = [];
  for (const it of sorted) {
    const l = lines.find((x) => Math.abs(x.y - it.y) <= 3);
    if (l) l.parts.push(it); else lines.push({ y: it.y, parts: [it] });
  }
  return lines
    .map((l) => ({ text: l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").trim(), h: Math.max(...l.parts.map((p) => p.h)) }))
    .filter((l) => l.text === l.text.toUpperCase() && /[A-Z]{3}/.test(l.text));
}
