import type { TextItem } from "../types";

/**
 * Feet-and-inches as architects write them: `16'-8 11/16"`, `12'`, `6"`,
 * `3'-0"`, `20' 6"`, `20.5` (bare feet), `246"`. Returns feet, or null.
 */
const FT_IN_RE = /^(?:(\d+(?:\.\d+)?)\s*(?:'|’|ft)\s*-?\s*)?(?:(\d+(?:\.\d+)?)?(?:\s+(\d+)\/(\d+))?\s*(?:"|''|”|in))?$/;

export function parseFeetInches(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(FT_IN_RE);
  if (!m) return null;
  const [, ft, inWhole, num, den] = m;
  if (ft === undefined && inWhole === undefined && num === undefined) return null;
  let inches = inWhole ? Number(inWhole) : 0;
  if (num && den && Number(den)) inches += Number(num) / Number(den);
  const feet = (ft ? Number(ft) : 0) + inches / 12;
  return feet > 0 ? feet : null;
}

export function formatFeetInches(feet: number): string {
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12 * 16) / 16;
  if (inches >= 12) return `${whole + 1}'-0"`;
  const inWhole = Math.floor(inches);
  const frac = inches - inWhole;
  const fracText = frac ? ` ${Math.round(frac * 16)}/16`.replace(/ (\d+)\/16/, (_m, n) => { const g = gcd(Number(n), 16); return ` ${Number(n) / g}/${16 / g}`; }) : "";
  return `${whole}'-${inWhole}${fracText}"`;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export type DimensionString = { itemId: string; text: string; feet: number; x: number; y: number; w: number; h: number };

/** A dimension as drawn on a plan: feet-inches with a foot mark, not a bare number (those are elevations, areas, room sizes). */
const DIM_TEXT_RE = /^\d+'-\d+(?:\s\d+\/\d+)?"$|^\d+'-\d+"$|^\d+'$/;

/** The dimension strings on a page, with their centre. Only strings a dimension line would carry. */
export function findDimensionStrings(items: readonly TextItem[]): DimensionString[] {
  const out: DimensionString[] = [];
  for (const it of items) {
    const text = it.str.trim();
    if (!DIM_TEXT_RE.test(text)) continue;
    const feet = parseFeetInches(text);
    if (!feet || feet < 0.5 || feet > 500) continue;
    out.push({ itemId: it.id, text, feet, x: it.x, y: it.y, w: it.w, h: it.h });
  }
  return out;
}
