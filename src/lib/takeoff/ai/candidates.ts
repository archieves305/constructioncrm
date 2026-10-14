import type { PageGeometry, PageText } from "../types";

/**
 * What the model may pick from on a roof plan: the sheet's labels that could
 * name a drain, a slope or the roof, and its longest drawn segments, each
 * with an id that is rebuilt the same way every time from the stored page
 * (longest first, ties by position). Pure.
 */
export const CANDIDATE_MIN_LEN_PT = 30;
export const CANDIDATE_MAX = 1500;
/** How many of the candidates are listed in the prompt; the rest only serve snapping. */
export const PROMPT_SEGMENTS = 220;
/** The long edge of the image sent to the model, under its 2,576 px limit. */
export const AI_IMAGE_MAX_PX = 2000;

export type CandidateSegment = { id: string; x1: number; y1: number; x2: number; y2: number; len: number };
export type CandidateLabel = { id: string; str: string; x: number; y: number; w: number; h: number };
export type RoofCandidates = { labels: CandidateLabel[]; segments: CandidateSegment[] };

export const ROOF_LABEL_RE = /DRAIN|SCUPPER|PARAPET|OVERFLOW|CRICKET|SLOPE|\/ ?1'-0"|^\d+'-\d+|SLAB|ROOF|^R\.?D\.?$|^O\.?D\.?$|^E\.?O\.?D\.?$/i;

export function roofCandidates(text: PageText | null, geometry: PageGeometry | null): RoofCandidates {
  const labels: CandidateLabel[] = (text?.items ?? [])
    .filter((i) => ROOF_LABEL_RE.test(i.str))
    .map((i) => ({ id: i.id, str: i.str, x: i.x, y: i.y, w: i.w, h: i.h }));
  const segments: CandidateSegment[] = (geometry?.segments ?? [])
    .filter((s) => s.len >= CANDIDATE_MIN_LEN_PT)
    .sort((a, b) => b.len - a.len || a.x1 - b.x1 || a.y1 - b.y1 || a.x2 - b.x2 || a.y2 - b.y2)
    .slice(0, CANDIDATE_MAX)
    .map((s, i) => ({ id: `s${i}`, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, len: s.len }));
  return { labels, segments };
}

/** The render that goes to the model: the largest whole-dpi scale that keeps the long edge under the limit, never above 144. */
export function imageScale(widthPt: number, heightPt: number, maxPx = AI_IMAGE_MAX_PX): { dpi: number; pxPerPt: number; widthPx: number; heightPx: number } {
  const long = Math.max(widthPt, heightPt, 1);
  const dpi = Math.max(1, Math.min(144, Math.floor((maxPx * 72) / long)));
  const pxPerPt = dpi / 72;
  return { dpi, pxPerPt, widthPx: Math.ceil(widthPt * pxPerPt), heightPx: Math.ceil(heightPt * pxPerPt) };
}
