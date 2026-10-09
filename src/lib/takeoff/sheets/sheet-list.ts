import type { PlanDisciplineName, TextItem } from "../types";
import { disciplineFromWord } from "./discipline";
import { joinWhileClose, looksLikeSheetNumber, normalizeSheetNumber, runsLeftOf, runsRightOf } from "./text-lines";

export type SheetListEntry = { sheetNumber: string; title: string | null; discipline: PlanDisciplineName | null };

export type SheetList = { found: boolean; entries: SheetListEntry[] };

const HEADER_RE = /^(SHEET\s*(LIST|INDEX)|DRAWING\s*(LIST|INDEX)|INDEX\s*OF\s*(DRAWINGS|SHEETS)|LIST\s*OF\s*DRAWINGS)$/i;

/**
 * The sheet list on a cover sheet: one row per sheet with the discipline in a
 * column to the left and the title to the right. Rows are matched on the
 * baseline, so a table whose columns were emitted one column at a time still
 * reads correctly. Without a header the page is not a sheet list, however many
 * sheet-like strings it holds (a details sheet references many).
 */
export function parseSheetList(items: readonly TextItem[]): SheetList {
  const header = items.find((i) => HEADER_RE.test(i.str.replace(/\s+/g, " ").trim()));
  if (!header) return { found: false, entries: [] };
  const numbers = items.filter((i) => looksLikeSheetNumber(i.str) && i.y >= header.y - 5);
  const byNumber = new Map<string, SheetListEntry>();
  for (const n of numbers.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const sheetNumber = normalizeSheetNumber(n.str);
    if (byNumber.has(sheetNumber)) continue;
    const left = runsLeftOf(items, n).find((r) => disciplineFromWord(r.str));
    const discipline = left ? disciplineFromWord(left.str) : null;
    const right = joinWhileClose(runsRightOf(items, n).filter((r) => !looksLikeSheetNumber(r.str)), 80);
    const titleRuns = right.length && right[0].x - (n.x + n.w) <= 300 ? right : [];
    const title = titleRuns.map((r) => r.str).join(" ").trim() || null;
    byNumber.set(sheetNumber, { sheetNumber, title, discipline });
  }
  return { found: byNumber.size > 0, entries: [...byNumber.values()] };
}
