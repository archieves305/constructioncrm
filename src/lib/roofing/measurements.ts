/**
 * Roof measurements as the CRM keeps them: what is stored from a parsed
 * report, how a person's correction is recorded, and when a measurement needs
 * a person to look at it. Pure — no database, no framework.
 */
import { REVIEW_THRESHOLD, type Measurements, type PitchBand, type RoofrParseResult } from "./types";

export type MeasurementFieldKind = "squares" | "area" | "length" | "count" | "pitch";

export type MeasurementField = {
  key: MeasurementKey;
  label: string;
  kind: MeasurementFieldKind;
  /** A measurement report does not give this; a person enters it. */
  manualOnly?: boolean;
};

/** Every number (and the pitch) a person may see and correct, in display order. */
export const MEASUREMENT_FIELDS = [
  { key: "totalSquares", label: "Total squares", kind: "squares" },
  { key: "roofAreaSqFt", label: "Roof area", kind: "area" },
  { key: "pitchedAreaSqFt", label: "Pitched area", kind: "area" },
  { key: "flatAreaSqFt", label: "Flat area", kind: "area" },
  { key: "predominantPitch", label: "Predominant pitch", kind: "pitch" },
  { key: "facets", label: "Facets", kind: "count" },
  { key: "eavesLf", label: "Eaves", kind: "length" },
  { key: "rakesLf", label: "Rakes", kind: "length" },
  { key: "ridgesLf", label: "Ridges", kind: "length" },
  { key: "hipsLf", label: "Hips", kind: "length" },
  { key: "ridgesHipsLf", label: "Ridges + hips", kind: "length" },
  { key: "valleysLf", label: "Valleys", kind: "length" },
  { key: "dripEdgeLf", label: "Drip edge", kind: "length" },
  { key: "stepFlashingLf", label: "Step flashing", kind: "length" },
  { key: "flashingLf", label: "Wall flashing", kind: "length" },
  { key: "flashingAreaSqFt", label: "Flashing area", kind: "area" },
  { key: "penetrations", label: "Penetrations", kind: "count", manualOnly: true },
  { key: "skylights", label: "Skylights", kind: "count", manualOnly: true },
  { key: "chimneys", label: "Chimneys", kind: "count", manualOnly: true },
  { key: "stories", label: "Stories", kind: "count", manualOnly: true },
] as const satisfies readonly { key: string; label: string; kind: MeasurementFieldKind; manualOnly?: boolean }[];

export type MeasurementKey = (typeof MEASUREMENT_FIELDS)[number]["key"];
export const MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.map((f) => f.key);

const INTEGER_KEYS = new Set<MeasurementKey>(["facets", "penetrations", "skylights", "chimneys", "stories"]);

export type MeasurementValues = { [K in MeasurementKey]?: K extends "predominantPitch" ? string | null : number | null };

export type Override = { value: number | string | null; previous: number | string | null; by: string; at: string };
export type Overrides = Partial<Record<MeasurementKey, Override>>;

/** The columns written when a report is parsed. Unknown stays null — never 0. */
export function columnsFromParse(parse: RoofrParseResult) {
  const m = parse.measurements;
  const values: MeasurementValues = {};
  for (const key of MEASUREMENT_KEYS) {
    const v = (m as Record<string, unknown>)[key];
    if (key === "predominantPitch") values.predominantPitch = typeof v === "string" && v ? v : null;
    else if (typeof v === "number" && Number.isFinite(v)) (values as Record<string, number | null>)[key] = INTEGER_KEYS.has(key) ? Math.round(v) : v;
    else (values as Record<string, number | null>)[key] = null;
  }
  return {
    ...values,
    pitchBands: validBands(m.pitchBands),
    parsedAddress: parse.parsedAddress ?? null,
    reportDate: parse.reportDate ?? null,
    existingRoofType: parse.existingRoofType ?? null,
    reportWastePct: parse.reportWaste?.recommendedPct ?? null,
    reportWasteOptions: parse.reportWaste?.options ?? null,
    parseConfidence: parse.confidence,
    fieldConfidence: parse.fieldConfidence as Record<string, number>,
    rawExtract: parse.rawExtract,
    warnings: parse.warnings,
  };
}

export function validBands(bands: unknown): PitchBand[] | null {
  if (!Array.isArray(bands)) return null;
  const out = bands.filter(
    (b): b is PitchBand => !!b && typeof b.pitch === "string" && /^\d{1,2}\/12$/.test(b.pitch) && typeof b.areaSqFt === "number" && Number.isFinite(b.areaSqFt) && b.areaSqFt >= 0,
  );
  return out.length ? out.map((b) => ({ pitch: b.pitch, areaSqFt: b.areaSqFt })) : null;
}

/** Why a typed value is refused, in words for the person; null when it is fine. */
export function valueProblem(key: MeasurementKey, value: unknown): string | null {
  if (value === null) return null;
  const field = MEASUREMENT_FIELDS.find((f) => f.key === key)!;
  if (key === "predominantPitch") {
    return typeof value === "string" && /^\d{1,2}\/12$/.test(value) ? null : `${field.label} is written like 6/12`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return `${field.label} must be a number`;
  if (value < 0) return `${field.label} cannot be negative`;
  if (INTEGER_KEYS.has(key) && !Number.isInteger(value)) return `${field.label} must be a whole number`;
  if (value > 1_000_000) return `${field.label} is too large`;
  return null;
}

/**
 * A person's corrections. Only fields whose value really changes are written;
 * each is remembered in `overrides` with the value it replaced — the FIRST
 * replaced value is kept, so the report's own reading is never lost however
 * many times a field is corrected. Setting a field back to what the report
 * read removes its override.
 */
export function applyEdits(
  current: MeasurementValues,
  overrides: Overrides | null | undefined,
  edits: MeasurementValues,
  who: string,
  at: Date,
): { data: MeasurementValues; overrides: Overrides; changed: MeasurementKey[] } {
  const next: Overrides = { ...(overrides ?? {}) };
  const data: MeasurementValues = {};
  const changed: MeasurementKey[] = [];
  for (const key of MEASUREMENT_KEYS) {
    if (!(key in edits)) continue;
    const value = (edits as Record<string, number | string | null>)[key] ?? null;
    const now = (current as Record<string, number | string | null | undefined>)[key] ?? null;
    if (value === now) continue;
    (data as Record<string, number | string | null>)[key] = value;
    changed.push(key);
    const original = next[key] ? next[key]!.previous : now;
    if (value === original) delete next[key];
    else next[key] = { value, previous: original, by: who, at: at.toISOString() };
  }
  return { data, overrides: next, changed };
}

/** Fields the takeoff cannot do without. */
const ESSENTIAL: readonly MeasurementKey[] = ["totalSquares", "eavesLf", "rakesLf"];

export type ReviewState = {
  /** A person should look before this is used for an estimate. */
  needsReview: boolean;
  reasons: string[];
  /** Fields the parser was unsure of and nobody has corrected. */
  unsureFields: MeasurementKey[];
};

export function reviewState(m: {
  source: "ROOFR" | "MANUAL" | "FIELD";
  parseConfidence: number | null;
  fieldConfidence: unknown;
  overrides: unknown;
  reviewedAt: Date | string | null;
  values: MeasurementValues;
}): ReviewState {
  const reasons: string[] = [];
  const missing = ESSENTIAL.filter((k) => m.values[k] == null);
  if (m.values.totalSquares == null && m.values.roofAreaSqFt != null) missing.splice(missing.indexOf("totalSquares"), 1);
  if (missing.length) reasons.push(`Missing: ${missing.map((k) => MEASUREMENT_FIELDS.find((f) => f.key === k)!.label.toLowerCase()).join(", ")}`);

  const conf = (m.fieldConfidence ?? {}) as Record<string, number>;
  const over = (m.overrides ?? {}) as Overrides;
  const unsureFields = m.source === "ROOFR" ? MEASUREMENT_KEYS.filter((k) => typeof conf[k] === "number" && conf[k] < REVIEW_THRESHOLD && !over[k] && m.values[k] != null) : [];
  if (!m.reviewedAt) {
    if (m.source === "ROOFR" && m.parseConfidence != null && m.parseConfidence < REVIEW_THRESHOLD) reasons.push("The report was hard to read");
    if (unsureFields.length) reasons.push(`Check: ${unsureFields.map((k) => MEASUREMENT_FIELDS.find((f) => f.key === k)!.label.toLowerCase()).join(", ")}`);
  }
  return { needsReview: reasons.length > 0, reasons, unsureFields: m.reviewedAt ? [] : unsureFields };
}

/** The shape the takeoff engine reads. */
export function toEngineMeasurements(row: MeasurementValues & { pitchBands?: unknown }): Measurements {
  const out: Measurements = {};
  for (const key of MEASUREMENT_KEYS) {
    if (key === "skylights" || key === "chimneys" || key === "stories") continue;
    (out as Record<string, unknown>)[key] = (row as Record<string, unknown>)[key] ?? null;
  }
  out.pitchBands = validBands(row.pitchBands);
  return out;
}
