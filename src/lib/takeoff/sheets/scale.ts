import type { TextItem } from "../types";

/**
 * Drawing scales as printed on sheets, turned into PDF points per real foot.
 *
 * `1/4" = 1'-0"` means a quarter inch on paper is one foot: 72 × 1/4 = 18 pt
 * per foot. `1" = 20'` (engineering) is 72 / 20 = 3.6. `1:100` (metric ratio)
 * is 72 × 12 / 100 = 8.64. A printed scale is only a claim — PDFs get resized —
 * so the calibration step (M2) checks it against the drawn dimensions.
 */
export type ParsedScale = { label: string; ptPerFt: number | null; nts: boolean };

const ARCH_RE = /(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:"|''|”)\s*=\s*(\d+)\s*(?:'|’)\s*(?:-?\s*(\d+)\s*(?:"|''|”))?/;
const RATIO_RE = /\b1\s*:\s*(\d{1,4})\b/;
const NTS_RE = /\b(?:N\.?\s?T\.?\s?S\.?|NOT\s+TO\s+SCALE)\b/i;

function inches(text: string): number {
  const parts = text.trim().split(/\s+/);
  let total = 0;
  for (const p of parts) {
    if (p.includes("/")) {
      const [n, d] = p.split("/").map(Number);
      if (d) total += n / d;
    } else total += Number(p);
  }
  return total;
}

/** The scale a string states, or null when it states none. */
export function parseScaleText(text: string): ParsedScale | null {
  const t = text.replace(/\s+/g, " ").trim();
  const arch = t.match(ARCH_RE);
  if (arch) {
    const paperIn = inches(arch[1]);
    const realFt = Number(arch[2]) + (arch[3] ? Number(arch[3]) / 12 : 0);
    if (paperIn > 0 && realFt > 0) {
      const label = `${arch[1].trim()}" = ${arch[2]}'-${arch[3] ?? "0"}"`;
      return { label, ptPerFt: round4((paperIn * 72) / realFt), nts: false };
    }
  }
  const ratio = t.match(RATIO_RE);
  if (ratio) {
    const r = Number(ratio[1]);
    if (r > 0) return { label: `1:${r}`, ptPerFt: round4((72 * 12) / r), nts: false };
  }
  if (NTS_RE.test(t)) return { label: "NTS", ptPerFt: null, nts: true };
  return null;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export type ScaleHit = ParsedScale & { itemId: string; x: number; y: number };

/** Every scale statement on a page, with where it sits. Adjacent runs are joined so `1/4"` + `= 1'-0"` reads as one. */
export function findScaleTexts(items: readonly TextItem[]): ScaleHit[] {
  const hits: ScaleHit[] = [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    const it = sorted[i];
    let text = it.str;
    // join up to two following runs on the same baseline when the first alone is not a scale
    for (let j = i + 1; j < sorted.length && j <= i + 2 && !parseScaleText(text); j++) {
      const n = sorted[j];
      if (Math.abs(n.y - it.y) > 3 || n.x - (it.x + it.w) > 30) break;
      text += " " + n.str;
    }
    const parsed = parseScaleText(text);
    if (parsed && !(parsed.nts && !/scale|nts|n\.t\.s/i.test(text) && text.length > 40)) hits.push({ ...parsed, itemId: it.id, x: it.x, y: it.y });
  }
  return hits;
}

export type SheetScale = { scaleText: string | null; ptPerFt: number | null; source: "title_block" | "page_text" | "none"; confidence: number; others: string[] };

/**
 * The sheet's scale: the statement in the title block when there is one;
 * otherwise a single distinct value found on the page (lower confidence);
 * otherwise none — a page with several different scales (details) stays
 * uncalibrated until a person decides.
 */
export function scaleForSheet(items: readonly TextItem[], widthPt: number, heightPt: number): SheetScale {
  const hits = findScaleTexts(items).filter((h) => !h.nts);
  const distinct = [...new Set(hits.map((h) => h.label))];
  const inBlock = hits.filter((h) => h.x > widthPt * 0.8 || h.y > heightPt * 0.85);
  if (inBlock.length) {
    const pick = inBlock[0];
    return { scaleText: pick.label, ptPerFt: pick.ptPerFt, source: "title_block", confidence: 0.9, others: distinct.filter((d) => d !== pick.label) };
  }
  if (distinct.length === 1) {
    const pick = hits[0];
    // the same scale stated several times (every drawing on the sheet) is a stronger claim than once
    return { scaleText: pick.label, ptPerFt: pick.ptPerFt, source: "page_text", confidence: hits.length > 1 ? 0.8 : 0.6, others: [] };
  }
  if (distinct.length > 1) {
    // several scales: prefer the one stated most often, but say the others exist
    const counts = new Map<string, number>();
    for (const h of hits) counts.set(h.label, (counts.get(h.label) ?? 0) + 1);
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const pick = hits.find((h) => h.label === best[0])!;
    return { scaleText: pick.label, ptPerFt: pick.ptPerFt, source: "page_text", confidence: 0.4, others: distinct.filter((d) => d !== pick.label) };
  }
  return { scaleText: null, ptPerFt: null, source: "none", confidence: 0, others: [] };
}
