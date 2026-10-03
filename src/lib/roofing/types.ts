/**
 * Types shared by the roofing library: the Roofr parser, the takeoff engine
 * and the screens that show their results.
 *
 * This folder is a self-contained library. Nothing in `parsing/` or `engine/`
 * imports the database, the framework or the rest of the CRM: plain objects
 * in, plain objects out. That is what lets the engine be tested exactly, and
 * lifted out later if it ever needs to run on its own. Ported from the
 * roofing estimator (roofing.careyos.com) at its 2026-06-19 build.
 */

/** The roof types the takeoff rules know. Low-slope areas of any roof get the membrane system automatically. */
export type RoofType = "SHINGLE" | "TILE" | "METAL";
export const ROOF_TYPES: readonly RoofType[] = ["SHINGLE", "TILE", "METAL"];

/** One row of Roofr's per-pitch area table. `pitch` is "<rise>/12". */
export interface PitchBand {
  pitch: string;
  areaSqFt: number;
}

// Canonical measurement shape used by the parser, the estimating engines, and
// the UI. All linear measures are in feet; areas in square feet; "squares" is
// the roofing unit (1 square = 100 sq ft).
export interface Measurements {
  totalSquares?: number | null;
  roofAreaSqFt?: number | null;
  /** Steep-slope area as Roofr summarizes it ("Total pitched area"). Note: Roofr
   * buckets 2/12 as flat, but KNU shingles 2/12 — for material math the engine
   * prefers `pitchBands` + a pitch threshold over this summary value. */
  pitchedAreaSqFt?: number | null;
  /** Low-slope area as Roofr summarizes it ("Total flat area"); includes 2/12. */
  flatAreaSqFt?: number | null;
  /** Roofr's per-pitch breakdown table (e.g. [{pitch:"2/12", areaSqFt:2295}]).
   * The engine splits steep vs low-slope off this at a configurable pitch
   * threshold (default <2/12 → low-slope membrane). */
  pitchBands?: PitchBand[] | null;
  facets?: number | null;
  predominantPitch?: string | null;
  eavesLf?: number | null;
  rakesLf?: number | null;
  valleysLf?: number | null;
  hipsLf?: number | null;
  ridgesLf?: number | null;
  ridgesHipsLf?: number | null;
  dripEdgeLf?: number | null;
  stepFlashingLf?: number | null;
  flashingLf?: number | null;
  flashingAreaSqFt?: number | null;
  penetrations?: number | null;
  suggestedWastePct?: number | null;
}

export type FieldConfidence = Partial<Record<keyof Measurements, number>>;

export interface RoofrParseResult {
  parsedAddress?: string;
  reportDate?: Date;
  existingRoofType?: string;
  measurements: Measurements;
  fieldConfidence: FieldConfidence;
  /** Overall 0..1 confidence; low → route to manual review. */
  confidence: number;
  usedOcr: boolean;
  rawText: string;
  /** Raw key/value pairs captured for audit. */
  rawExtract: Record<string, string>;
  /** Human-readable notes about what could not be parsed. */
  warnings: string[];
  /**
   * The waste Roofr marks "Recommended" and the options beside it, as
   * fractions. Roofr bases it on an asphalt shingle roof. Shown to the
   * estimator as a suggestion; only a PDF carries it (it is a position on the
   * page, not text).
   */
  reportWaste?: { recommendedPct: number; options: number[] } | null;
}

export interface MaterialLineDraft {
  category: string;
  name: string;
  sku?: string | null;
  unitType: string;
  baseQuantity: number;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  wasteApplied: boolean;
  ruleKey?: string;
  calcNote?: string;
  materialItemId?: string | null;
}

export interface EstimateResult {
  roofType: RoofType;
  wasteFactorPct: number;
  items: MaterialLineDraft[];
  subtotal: number;
  total: number;
  confidence: number;
  warnings: string[];
  measurementSnapshot: Measurements;
}

// Confidence below this routes a parse/estimate to the manual review queue.
export const REVIEW_THRESHOLD = 0.7;
