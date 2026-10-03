import type {
  FieldConfidence,
  Measurements,
  PitchBand,
  RoofrParseResult,
} from "../types";
// NOTE: ./pdf is server-only (Node libs). It is imported dynamically inside
// parseRoofrPdf so this module's pure text parser (parseRoofrText) stays
// importable from tests and any non-server context.

// Deterministic structured extraction from Roofr report text. Roofr exports
// label/value pairs ("Total Squares: 32.4", "Predominant Pitch 6/12", etc.).
// We match each canonical field against a list of label aliases and capture the
// adjacent number. Everything is best-effort with per-field confidence so the
// caller can route low-confidence parses to manual review.

interface NumericFieldSpec {
  key: keyof Measurements;
  labels: string[];
  /** When true the value is an integer count, not a measurement. */
  integer?: boolean;
  /** Unit hints that boost confidence when found next to the number. */
  unitHints?: string[];
}

const NUMERIC_FIELDS: NumericFieldSpec[] = [
  { key: "totalSquares", labels: ["total squares", "squares", "roofing squares", "total roof squares"] },
  { key: "roofAreaSqFt", labels: ["total roof area", "roof area", "total area"], unitHints: ["sq ft", "sqft", "ft²", "sf"] },
  { key: "facets", labels: ["facets", "number of facets", "roof facets"], integer: true },
  { key: "eavesLf", labels: ["eaves", "eave", "total eaves"], unitHints: ["ft", "lf", "linear"] },
  { key: "rakesLf", labels: ["rakes", "rake", "total rakes"], unitHints: ["ft", "lf", "linear"] },
  { key: "valleysLf", labels: ["valleys", "valley", "total valleys"], unitHints: ["ft", "lf", "linear"] },
  { key: "hipsLf", labels: ["hips", "hip"], unitHints: ["ft", "lf", "linear"] },
  { key: "ridgesLf", labels: ["ridges", "ridge"], unitHints: ["ft", "lf", "linear"] },
  { key: "ridgesHipsLf", labels: ["ridges/hips", "ridges and hips", "hips/ridges", "ridge/hip", "ridges & hips"], unitHints: ["ft", "lf"] },
  { key: "dripEdgeLf", labels: ["drip edge", "drip-edge"], unitHints: ["ft", "lf"] },
  { key: "stepFlashingLf", labels: ["step flashing", "step-flashing"], unitHints: ["ft", "lf"] },
  { key: "flashingLf", labels: ["flashing", "wall flashing", "headwall", "sidewall"], unitHints: ["ft", "lf"] },
  { key: "flashingAreaSqFt", labels: ["flashing area"], unitHints: ["sq ft", "sqft"] },
  { key: "penetrations", labels: ["penetrations", "pipe penetrations", "roof penetrations", "vents"], integer: true },
];

const NUM = String.raw`(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)`;

function toNumber(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

/** Find the first numeric value associated with any of the given labels. */
function matchNumeric(text: string, spec: NumericFieldSpec): { value: number; confidence: number; raw: string } | null {
  for (const label of spec.labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    // label [: -] number [unit]
    const re = new RegExp(`${escaped}\\s*[:\\-]?\\s*${NUM}\\s*([a-z²]+)?`, "i");
    const m = text.match(re);
    if (m) {
      const value = toNumber(m[1]);
      if (Number.isNaN(value)) continue;
      const unit = (m[2] || "").toLowerCase();
      let confidence = 0.8;
      if (spec.unitHints && spec.unitHints.some((u) => unit.startsWith(u.replace(/\s/g, "")))) {
        confidence = 0.95;
      }
      // Penalize implausibly large/small captures (likely a mis-grab).
      if (spec.integer && !Number.isInteger(value) && Math.abs(value) > 5) confidence -= 0.2;
      return { value: spec.integer ? Math.round(value) : value, confidence, raw: m[0].trim() };
    }
  }
  return null;
}

function matchPitch(text: string): { value: string; confidence: number; raw: string } | null {
  const re = /(?:predominant\s+pitch|pitch)\s*[:\-]?\s*(\d{1,2})\s*[\/:]\s*12/i;
  const m = text.match(re);
  if (m) return { value: `${m[1]}/12`, confidence: 0.9, raw: m[0].trim() };
  // Bare "6/12" anywhere
  const m2 = text.match(/\b(\d{1,2})\/12\b/);
  if (m2) return { value: `${m2[1]}/12`, confidence: 0.6, raw: m2[0] };
  return null;
}

function matchWaste(text: string): { value: number; confidence: number; raw: string } | null {
  const re = /waste\s*(?:factor)?\s*[:\-]?\s*(\d{1,2}(?:\.\d+)?)\s*%/i;
  const m = text.match(re);
  if (m) return { value: toNumber(m[1]) / 100, confidence: 0.9, raw: m[0].trim() };
  return null;
}

function matchAddress(text: string): { value: string; confidence: number } | null {
  // Explicit label first.
  const labeled = text.match(/(?:property\s+address|address|location|job\s+address)\s*[:\-]?\s*(.+)/i);
  if (labeled) {
    let candidate = labeled[1].split(/\r?\n/)[0].trim();
    // Bound the capture: if the line ran on (no line breaks in the source PDF),
    // cut it before the next known report label and cap the length.
    candidate = candidate.split(
      /\s+(?:report\s+date|date|predominant|pitch|total\s+roof|total\s+squares|squares|number\s+of\s+facets|facets|eaves|rakes|valleys|hips|ridges|penetrations|waste|existing)\b/i,
    )[0].trim();
    if (candidate.length > 80) candidate = candidate.slice(0, 80).trim();
    if (/\d/.test(candidate) && candidate.length > 6) {
      return { value: candidate.replace(/\s{2,}/g, " "), confidence: 0.85 };
    }
  }
  // Fallback: a line that looks like a US street address. Roofr reports print the
  // property address as a bare line (no "Address:" label), so this path is the
  // norm, not the exception — score it by completeness. A full "street, city, ST
  // ZIP" with a 5-digit ZIP is structurally reliable even unlabeled; a bare
  // street fragment is not.
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const full = lines.find((l) => /^\d+\s+\S+.*\b[A-Z]{2}\b\s*\d{5}/.test(l));
  if (full) return { value: full.replace(/\s{2,}/g, " "), confidence: 0.82 };
  const partial = lines.find((l) => /^\d+\s+[A-Za-z0-9 .'-]+,/.test(l));
  if (partial) return { value: partial.replace(/\s{2,}/g, " "), confidence: 0.6 };
  return null;
}

function matchReportDate(text: string): Date | undefined {
  const m =
    text.match(/(?:report\s+date|date|generated|prepared)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i) ||
    text.match(/(?:report\s+date|date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (!m) return undefined;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function matchExistingRoofType(text: string): string | undefined {
  const m = text.match(/(?:existing|current)\s+(?:roof\s+)?(?:type|material)\s*[:\-]?\s*([A-Za-z ]+)/i);
  if (m) return m[1].split(/\r?\n/)[0].trim();
  return undefined;
}

/** Convert a Roofr "248ft 11in" length to decimal feet. */
function ftInToFeet(s: string): number | null {
  const m = s.match(/(\d+)\s*ft\s*(\d+)?\s*in?/i);
  if (!m) return null;
  return Math.round((parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 12 : 0)) * 100) / 100;
}

// Real Roofr reports print a "Report summary" with `Total <field> 248ft 11in`
// lengths and `Total roof area 3247 sqft`. This layer reads that exact format
// (high confidence) before the generic alias matcher fills any gaps.
interface SummaryResult {
  measurements: Measurements;
  fieldConfidence: FieldConfidence;
  rawExtract: Record<string, string>;
}

const SUMMARY_LF_FIELDS: { key: keyof Measurements; label: string }[] = [
  { key: "eavesLf", label: "total eaves" },
  { key: "rakesLf", label: "total rakes" },
  { key: "valleysLf", label: "total valleys" },
  { key: "hipsLf", label: "total hips" },
  { key: "ridgesLf", label: "total ridges" },
  { key: "ridgesHipsLf", label: "hips \\+ ridges" },
  { key: "stepFlashingLf", label: "total step flashing" },
  { key: "flashingLf", label: "total wall flashing" },
];

function extractRoofrSummary(text: string): SummaryResult {
  const measurements: Measurements = {};
  const fieldConfidence: FieldConfidence = {};
  const rawExtract: Record<string, string> = {};

  // Multi-structure Roofr reports print per-structure blocks BEFORE the
  // property-wide "Report summary" (each with its own "Total pitched area", pitch
  // table, etc.). Scope all reads to that section so we capture the COMBINED
  // totals and the combined per-pitch table — not just structure #1. (This also
  // fixes a latent first-occurrence bug for roof area / eaves on such reports.)
  const summaryIdx = text.search(/report summary/i);
  if (summaryIdx >= 0) text = text.slice(summaryIdx);

  const area = text.match(/total roof area:?\s*([\d,]+)\s*sqft/i);
  if (area) {
    const sqft = parseFloat(area[1].replace(/,/g, ""));
    measurements.roofAreaSqFt = sqft;
    fieldConfidence.roofAreaSqFt = 0.95;
    rawExtract.roofAreaSqFt = area[0].trim();
    // Roofr's per-pitch "Squares" line is split; area ÷ 100 is the reliable total.
    // It's exact arithmetic off a 0.95-confidence area read, so score it nearly as
    // high (small discount for being a derivation rather than a direct field read).
    measurements.totalSquares = Math.round((sqft / 100) * 10) / 10;
    fieldConfidence.totalSquares = 0.93;
  }

  // Roofr splits the total into steep-slope ("pitched") and low-slope ("flat").
  // Material math should run off pitched area, not the total — Roofr's own
  // calculations exclude flat area, which needs a separate flat-roof system.
  const pitched = text.match(/total pitched area:?\s*([\d,]+)\s*sqft/i);
  if (pitched) {
    measurements.pitchedAreaSqFt = parseFloat(pitched[1].replace(/,/g, ""));
    fieldConfidence.pitchedAreaSqFt = 0.95;
    rawExtract.pitchedAreaSqFt = pitched[0].trim();
  }
  const flat = text.match(/total flat area:?\s*([\d,]+)\s*sqft/i);
  if (flat) {
    measurements.flatAreaSqFt = parseFloat(flat[1].replace(/,/g, ""));
    fieldConfidence.flatAreaSqFt = 0.95;
    rawExtract.flatAreaSqFt = flat[0].trim();
  }

  // Roofr's per-pitch table pairs a "Pitch  1/12  3/12" row with an
  // "Area (sqft)  771  1,666" row. The engine uses this (not the pitched/flat
  // summary) to split steep vs low-slope at a pitch threshold, because Roofr
  // buckets 2/12 as flat while KNU shingles 2/12. Anchored on "...area (sqft)...
  // squares" so it can't match the predominant-pitch line or the later waste table.
  const pitchTable = text.match(/\bpitch\s+([\d/\s]+?)\s*area\s*\(sqft\)\s+([\d,\s]+?)\s*squares/i);
  if (pitchTable) {
    const pitches = pitchTable[1].trim().split(/\s+/).filter((p) => /^\d{1,2}\/12$/.test(p));
    const areas = pitchTable[2].trim().split(/\s+/).map((a) => parseFloat(a.replace(/,/g, "")));
    const bands: PitchBand[] = [];
    for (let i = 0; i < Math.min(pitches.length, areas.length); i++) {
      if (!Number.isNaN(areas[i])) bands.push({ pitch: pitches[i], areaSqFt: areas[i] });
    }
    if (bands.length) {
      measurements.pitchBands = bands;
      rawExtract.pitchBands = pitchTable[0].replace(/\s+/g, " ").trim();
    }
  }

  const facets = text.match(/total roof facets\s+(\d+)/i);
  if (facets) {
    measurements.facets = parseInt(facets[1], 10);
    fieldConfidence.facets = 0.95;
  }

  for (const { key, label } of SUMMARY_LF_FIELDS) {
    const m = text.match(new RegExp(`${label}\\s+(\\d+\\s*ft\\s*\\d*\\s*in?)`, "i"));
    if (!m) continue;
    const feet = ftInToFeet(m[1]);
    if (feet == null) continue;
    (measurements[key] as number) = feet;
    fieldConfidence[key] = 0.95;
    rawExtract[key] = m[0].trim();
  }

  // "Eaves + rakes 297ft 6in" → fill rakes if only the combined value is present.
  const er = text.match(/eaves \+ rakes\s+(\d+\s*ft\s*\d*\s*in?)/i);
  if (er) {
    const erFeet = ftInToFeet(er[1]);
    if (erFeet != null) {
      measurements.dripEdgeLf = erFeet; // drip edge runs the full eaves + rakes
      fieldConfidence.dripEdgeLf = 0.9;
      rawExtract.dripEdgeLf = er[0].trim();
      if (measurements.rakesLf == null && measurements.eavesLf != null) {
        measurements.rakesLf = Math.round((erFeet - measurements.eavesLf) * 100) / 100;
        fieldConfidence.rakesLf = 0.85;
      }
    }
  }
  return { measurements, fieldConfidence, rawExtract };
}

/** Extract structured Roofr data from already-extracted text. */
export function parseRoofrText(text: string, usedOcr = false): RoofrParseResult {
  const measurements: Measurements = {};
  const fieldConfidence: FieldConfidence = {};
  const rawExtract: Record<string, string> = {};
  const warnings: string[] = [];
  const lower = text.toLowerCase();

  // 1) Real Roofr "Report summary" format (ft+in, high confidence) first.
  const summary = extractRoofrSummary(lower);
  Object.assign(measurements, summary.measurements);
  Object.assign(fieldConfidence, summary.fieldConfidence);
  Object.assign(rawExtract, summary.rawExtract);

  // 2) Generic alias matcher fills any field the summary didn't provide
  //    (covers other report layouts and "Eaves: 120 ft" style exports).
  for (const spec of NUMERIC_FIELDS) {
    if (measurements[spec.key] != null) continue;
    const hit = matchNumeric(lower, spec);
    if (hit) {
      (measurements[spec.key] as number) = hit.value;
      fieldConfidence[spec.key] = hit.confidence;
      rawExtract[spec.key] = hit.raw;
    }
  }

  const pitch = matchPitch(lower);
  if (pitch) {
    measurements.predominantPitch = pitch.value;
    fieldConfidence.predominantPitch = pitch.confidence;
    rawExtract.predominantPitch = pitch.raw;
  }

  const waste = matchWaste(lower);
  if (waste) {
    measurements.suggestedWastePct = waste.value;
    fieldConfidence.suggestedWastePct = waste.confidence;
    rawExtract.suggestedWastePct = waste.raw;
  }

  // Derivations to fill gaps (lower confidence than a direct read).
  if (measurements.totalSquares == null && measurements.roofAreaSqFt != null) {
    measurements.totalSquares = Math.round((measurements.roofAreaSqFt / 100) * 10) / 10;
    fieldConfidence.totalSquares = 0.7;
    warnings.push("Total squares derived from roof area (÷100).");
  }
  if (measurements.roofAreaSqFt == null && measurements.totalSquares != null) {
    measurements.roofAreaSqFt = Math.round(measurements.totalSquares * 100);
    fieldConfidence.roofAreaSqFt = 0.7;
  }
  if (
    measurements.ridgesHipsLf == null &&
    (measurements.ridgesLf != null || measurements.hipsLf != null)
  ) {
    measurements.ridgesHipsLf = (measurements.ridgesLf || 0) + (measurements.hipsLf || 0);
    fieldConfidence.ridgesHipsLf = 0.75;
  }
  if (
    measurements.dripEdgeLf == null &&
    (measurements.eavesLf != null || measurements.rakesLf != null)
  ) {
    measurements.dripEdgeLf = (measurements.eavesLf || 0) + (measurements.rakesLf || 0);
    fieldConfidence.dripEdgeLf = 0.7;
    warnings.push("Drip edge derived from eaves + rakes.");
  }

  const address = matchAddress(text);
  const reportDate = matchReportDate(lower);
  const existingRoofType = matchExistingRoofType(lower);

  if (!measurements.totalSquares) warnings.push("Could not read total squares — manual entry required.");
  if (!address) warnings.push("Could not read a property address — manual entry required.");

  // Overall confidence: blend the presence/quality of the estimating-critical
  // fields (squares, eaves, ridges/hips, valleys) with the address. Measurements
  // get the larger weight because they drive every material calculation; the
  // address only identifies the property and matches invoices — it feeds no math —
  // so it shouldn't cap an otherwise clean parse.
  const critical: (keyof Measurements)[] = ["totalSquares", "eavesLf", "ridgesHipsLf", "valleysLf"];
  const criticalScores = critical.map((k) => fieldConfidence[k] ?? 0);
  const measurementScore = criticalScores.reduce((a, b) => a + b, 0) / critical.length;
  const addressScore = address?.confidence ?? 0;
  let confidence = Math.round((0.7 * measurementScore + 0.3 * addressScore) * 100) / 100;
  if (usedOcr) confidence = Math.max(0, confidence - 0.15);

  return {
    parsedAddress: address?.value,
    reportDate,
    existingRoofType,
    measurements,
    fieldConfidence,
    confidence,
    usedOcr,
    rawText: text,
    rawExtract,
    warnings,
  };
}

/** Full pipeline: PDF bytes → extracted text → structured Roofr result. */
export async function parseRoofrPdf(bytes: Buffer): Promise<RoofrParseResult> {
  const { extractPdfText } = await import("./pdf");
  const { text, usedOcr, recommendedWaste } = await extractPdfText(bytes);
  if (!text || text.replace(/\s/g, "").length < 20) {
    return {
      measurements: {},
      fieldConfidence: {},
      confidence: 0,
      usedOcr,
      rawText: text || "",
      rawExtract: {},
      warnings: ["No extractable text — the report appears to be a scanned image. Manual entry required."],
    };
  }
  // The report's own waste recommendation is kept beside the measurements, not
  // inside them: Roofr bases it on an asphalt shingle roof, and the takeoff
  // coefficients were calibrated without it, so a person chooses whether to
  // use it. It is never applied to an estimate silently.
  return { ...parseRoofrText(text, usedOcr), reportWaste: recommendedWaste };
}
