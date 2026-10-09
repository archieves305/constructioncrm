import type { DetectedIndex, TextItem } from "../types";
import { disciplineFor } from "./discipline";
import { scaleForSheet } from "./scale";
import { parseSheetList, type SheetList } from "./sheet-list";
import { parseTitleBlock } from "./title-block";

export type PageForIndex = { pageNumber: number; widthPt: number; heightPt: number; items: TextItem[] };

/** The sheet list of a document: the first page (looking at the first three) that carries one. */
export function documentSheetList(pages: readonly PageForIndex[]): SheetList {
  for (const p of [...pages].sort((a, b) => a.pageNumber - b.pageNumber).slice(0, 3)) {
    const list = parseSheetList(p.items);
    if (list.found) return list;
  }
  return { found: false, entries: [] };
}

/**
 * What a page is, from its own title block checked against the document's
 * sheet list. The title block decides the number (it is on the page); the
 * list supplies the title and discipline when it knows the number; the scale
 * comes from the page's own text. Confidence is the weakest of the parts.
 */
export function classifyPage(page: PageForIndex, list: SheetList): DetectedIndex {
  const block = parseTitleBlock(page.items, page.widthPt, page.heightPt);
  const listed = block.sheetNumber ? list.entries.find((e) => e.sheetNumber === block.sheetNumber) : undefined;
  const title = listed?.title ?? block.title;
  const titleSource = listed?.title ? "sheet_list" : block.title ? "title_block" : "none";
  const discipline = listed?.discipline ?? disciplineFor(block.sheetNumber, title);
  const disciplineSource = listed?.discipline ? "sheet_list" : block.sheetNumber || title ? "title_block" : "none";
  const scale = scaleForSheet(page.items, page.widthPt, page.heightPt);
  const numberConfidence = block.sheetNumber ? (listed ? Math.max(block.sheetNumberConfidence, 0.95) : block.sheetNumberConfidence) : 0;
  const titleConfidence = listed?.title ? 0.95 : block.title ? block.titleConfidence : 0.2;
  const confidence = Math.round(Math.min(numberConfidence, titleConfidence) * 100) / 100;
  return {
    sheetNumber: block.sheetNumber,
    title,
    discipline,
    scaleText: scale.scaleText,
    revisionLabel: block.revisionLabel,
    sources: { sheetNumber: block.sheetNumber ? "title_block" : "none", title: titleSource, discipline: disciplineSource, scale: scale.source },
    confidence,
    otherScales: scale.others,
  };
}
