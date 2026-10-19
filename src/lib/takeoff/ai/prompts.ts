/**
 * The frozen prompts of the roofing calls and the builders of their inputs.
 * Pure. The system text never changes without a new version string, because
 * the version is part of every call's cache key and the prompt cache prefix.
 * Nothing here decides a quantity: the model names and cites, code measures.
 * The drawings' own text goes in as an untrusted document (`@/lib/ai/untrusted`).
 */
import { untrustedDocument } from "@/lib/ai/untrusted";

export const ROOF_SPECS_PROMPT_VERSION = "roof-specs-2";
export const ROOF_REGIONS_PROMPT_VERSION = "roof-regions-2";

export const ROOF_SPECS_SYSTEM = [
  "You read text extracted from an architectural drawing set for a building in Florida.",
  "Task: identify the ROOF ASSEMBLY that is actually specified — the covering or membrane system, the deck, the insulation, the parapet detail, the slopes and the drainage.",
  "Quote only what the text supports. If the roof covering or membrane system is not named anywhere, return assembly = null and list what is missing in notSpecified. Never guess or infer a product from the building type, the region or custom.",
  "Each line is prefixed with sheet:lineId. Cite those ids in sourceLineIds and name the sheets in sourceSheets. Keep evidence to a short quotation.",
].join("\n");

export const ROOF_REGIONS_SYSTEM = [
  "You label a roof plan. The image is one sheet of an architectural drawing set, with the sheet's text items and its longest drawn line segments listed by id in image pixels.",
  "Return every distinct roof region as a polygon in IMAGE PIXELS of this image, tracing the drawn outline (the parapet or edge lines), not approximate boxes. Use the segment ids to bound each region where they fit and list them in boundedBySegmentIds. Classify each region. Give the slope text printed inside it when there is one.",
  "List the segment ids that run along the parapet (the roof's outer wall) in parapetSegmentIds. Identify each drain, overflow drain and scupper by the id of its text label. Count crickets.",
  "Do NOT compute any area or length; code will. Say in notes whether the roofing membrane or material is named on this sheet. If something is unclear, say so in the region's evidence and lower its confidence rather than inventing geometry.",
].join("\n");

export const MAX_SPEC_SHEETS = 8;
export const MAX_SPEC_LINES_PER_SHEET = 400;

export type SpecsSheetInput = { sheetNumber: string; title: string | null; lines: { id: string; text: string }[] };

/** The user turn of the specs call: the selected sheets' text with line ids. */
export function buildRoofSpecsInput(sheets: readonly SpecsSheetInput[], project: { address?: string | null }): string {
  const parts: string[] = [];
  parts.push(project.address ? `Project: ${project.address}.` : "Project: a building in Florida.");
  parts.push("Identify the roof assembly specified on these sheets.");
  const text: string[] = [];
  for (const s of sheets.slice(0, MAX_SPEC_SHEETS)) {
    text.push("", `=== SHEET ${s.sheetNumber}${s.title ? ` ${s.title}` : ""} ===`);
    for (const l of s.lines.slice(0, MAX_SPEC_LINES_PER_SHEET)) text.push(`${s.sheetNumber}:${l.id} ${l.text}`);
  }
  parts.push("", untrustedDocument("text of the drawing set", text.join("\n").trimStart()));
  return parts.join("\n");
}

export type RegionsPromptInput = {
  sheetNumber: string;
  title: string | null;
  imageWidthPx: number;
  imageHeightPx: number;
  pxPerPt: number;
  ptPerFt: number;
  scaleText: string | null;
  labels: readonly { id: string; str: string; xPx: number; yPx: number }[];
  segments: readonly { id: string; x1Px: number; y1Px: number; x2Px: number; y2Px: number; lenFt: number }[];
};

/** The text beside the image in the regions call. */
export function buildRoofRegionsPrompt(i: RegionsPromptInput): string {
  const pxPerFt = i.pxPerPt * i.ptPerFt;
  return [
    `This is sheet ${i.sheetNumber}${i.title ? ` "${i.title}"` : ""}, rendered at ${i.imageWidthPx}×${i.imageHeightPx} px (${i.pxPerPt.toFixed(4)} px per PDF point; scale ${i.scaleText ?? "as calibrated"}, i.e. ${pxPerFt.toFixed(3)} px per foot).`,
    "Label the roof as instructed.",
    "",
    'TEXT ITEMS (id "text" @(x,y) in image px):',
    untrustedDocument(`text items of sheet ${i.sheetNumber}`, i.labels.map((l) => `${l.id} "${l.str}" @(${l.xPx},${l.yPx})`).join("\n")),
    "",
    "LONGEST DRAWN SEGMENTS (id (x1,y1)-(x2,y2) length in feet at that scale):",
    ...i.segments.map((s) => `${s.id} (${s.x1Px},${s.y1Px})-(${s.x2Px},${s.y2Px}) len=${s.lenFt.toFixed(1)}ft`),
  ].join("\n");
}
