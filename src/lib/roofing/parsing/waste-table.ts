/**
 * Roofr's recommended waste, read from where the text sits on the page.
 *
 * A Roofr report prints a row of waste options ("Waste % 0% 6% 10% 12% 15% 17%
 * 20%") and the single word "Recommended" above one of them. Once the page is
 * flattened to lines of text that position is gone — the word lands on a line
 * of its own — so the recommendation cannot be recovered from the text. It is
 * recovered here from the glyph positions instead: the option whose centre is
 * nearest the centre of "Recommended".
 *
 * Checked against 22 real reports: the recommended column is not fixed. It
 * was the second option on most, the last on small or complex roofs (24%,
 * 35%), the first on an all-flat roof (0%), and the third or fourth on others.
 *
 * Pure: positioned text in, a number out.
 */

export type PositionedText = { str: string; x: number; y: number; width: number };

export type RecommendedWaste = {
  /** As a fraction: 0.08 for 8%. */
  recommendedPct: number;
  /** Every option on the row, as fractions, left to right. */
  options: number[];
};

/** How far off-centre "Recommended" may sit from its column before the reading is not trusted (PDF units). */
const MAX_OFFSET = 12;
/** Text on the same printed row sits within this many units vertically. */
const SAME_ROW = 2.5;

export function recommendedWasteFromItems(items: readonly PositionedText[]): RecommendedWaste | null {
  const clean = items.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str);
  const label = clean.find((i) => /^waste\s*%$/i.test(i.str));
  if (!label) return null;
  const row = clean.filter((i) => Math.abs(i.y - label.y) <= SAME_ROW && /^\d{1,2}(?:\.\d+)?%$/.test(i.str)).sort((a, b) => a.x - b.x);
  if (row.length < 2) return null;
  // The marker is printed just above the row; take the nearest one above it.
  const markers = clean.filter((i) => /^recommended$/i.test(i.str) && i.y > label.y).sort((a, b) => a.y - b.y);
  const marker = markers[0];
  if (!marker) return null;
  const centre = (i: PositionedText) => i.x + i.width / 2;
  const nearest = row.map((r) => ({ r, off: Math.abs(centre(r) - centre(marker)) })).sort((a, b) => a.off - b.off)[0];
  if (nearest.off > MAX_OFFSET) return null;
  const pct = (s: string) => Number(s.replace("%", "")) / 100;
  return { recommendedPct: pct(nearest.r.str), options: row.map((r) => pct(r.str)) };
}
