/**
 * Shapes shared by the plan-takeoff library. Pure and client-safe.
 *
 * Coordinates are "sheet points": PDF points with the origin at the top-left
 * of the page and y running down — what pdf.js's viewport transform at scale 1
 * produces, and what the renders are drawn in. A 72 dpi render is 1 px per
 * point; a 144 dpi render is 2 px per point.
 */

export type TextItem = {
  id: string;
  str: string;
  /** Left edge of the run, sheet points. */
  x: number;
  /** Baseline of the run, sheet points. */
  y: number;
  w: number;
  h: number;
};

export type PageText = {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  items: TextItem[];
};

export type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
  /** Stroke width in sheet points. */
  lw: number;
  /** Drawn inside a form XObject (a block / symbol). */
  form?: boolean;
};

export type GeometryStats = {
  ops: number;
  lines: number;
  curves: number;
  rects: number;
  forms: number;
  images: number;
  shadings: number;
};

export type PageGeometry = {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  segments: Segment[];
  stats: GeometryStats;
};

export type PlanDisciplineName =
  | "ARCHITECTURAL"
  | "STRUCTURAL"
  | "CIVIL"
  | "PLUMBING"
  | "MECHANICAL"
  | "ELECTRICAL"
  | "GAS"
  | "LANDSCAPE"
  | "LOW_VOLTAGE"
  | "IRRIGATION"
  | "GENERAL"
  | "UNKNOWN";

export const DISCIPLINE_LABEL: Record<PlanDisciplineName, string> = {
  ARCHITECTURAL: "Architectural",
  STRUCTURAL: "Structural",
  CIVIL: "Civil",
  PLUMBING: "Plumbing",
  MECHANICAL: "Mechanical",
  ELECTRICAL: "Electrical",
  GAS: "Gas",
  LANDSCAPE: "Landscape",
  LOW_VOLTAGE: "Low voltage",
  IRRIGATION: "Irrigation",
  GENERAL: "General",
  UNKNOWN: "Unknown",
};

export const DISCIPLINES = Object.keys(DISCIPLINE_LABEL) as PlanDisciplineName[];

/** Where a detected value came from, for the "detected vs corrected" view. */
export type DetectedSource = "sheet_list" | "title_block" | "page_text" | "none";

/** What code read from a page before anyone corrected it. */
export type DetectedIndex = {
  sheetNumber: string | null;
  title: string | null;
  discipline: PlanDisciplineName;
  scaleText: string | null;
  revisionLabel: string | null;
  sources: { sheetNumber: DetectedSource; title: DetectedSource; discipline: DetectedSource; scale: DetectedSource };
  /** 0..1 — how sure the index is as a whole. */
  confidence: number;
  /** Any other scale strings seen on the page, when more than one exists. */
  otherScales: string[];
};

export type SheetScaleSourceName = "NONE" | "AUTO" | "AUTO_VERIFIED" | "MANUAL";
export type PlanDocumentStatusName = "UPLOADED" | "INDEXING" | "INDEXED" | "FAILED";
export type PlanDocumentKindName = "FULL_SET" | "PARTIAL" | "ADDENDUM" | "REVISION";
export type PlanJobStatusName = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export type PlanJobStepStatusName = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

export const DOCUMENT_KIND_LABEL: Record<PlanDocumentKindName, string> = {
  FULL_SET: "Full set",
  PARTIAL: "Partial set",
  ADDENDUM: "Addendum",
  REVISION: "Revision",
};
