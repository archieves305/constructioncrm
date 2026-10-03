import type { EstimateResult, MaterialLineDraft, Measurements, RoofType } from "../types";
import type { RuleKind } from "./defaults";
import { round2, round4 } from "../round";

// Pure estimating engine. Given measurements, resolved rules, and a priced
// material catalog, it produces a complete material list with derivations,
// waste, rounding, and costs. No DB or I/O — fully unit-testable.

export interface ResolvedRule {
  key: string;
  label: string;
  category: string;
  kind: RuleKind;
  inputMetric?: string | null;
  value: number;
  unit?: string | null;
  params?: Record<string, unknown> | null;
}

export interface PricedMaterial {
  id: string;
  category: string;
  name: string;
  sku?: string | null;
  unitType: string;
  unitCost: number;
  roofType: RoofType | null;
  wasteFactor?: number | null;
}

export interface EstimateOptions {
  /** Override the roof-level waste factor (0..1). */
  wasteFactorPct?: number;
  /** Tile only: include battens. */
  battenInstall?: boolean;
  /** Default field confidence weighting input (0..1) from the parse. */
  parseConfidence?: number;
  /** Rise (per 12) below which a plane is low-slope/membrane; default 2 (so 2/12
   *  is shingled, matching KNU practice). Only used when pitch bands are present. */
  lowSlopeRise?: number;
}

/** Default rise (per 12) below which a roof plane is treated as low-slope/membrane.
 *  KNU shingles 2/12 (see 1061 NW 108th), so only <2/12 (0/12, 1/12) is membrane. */
export const DEFAULT_LOW_SLOPE_RISE = 2;

export interface SlopeSplit {
  steepAreaSqFt: number;
  lowSlopeAreaSqFt: number;
  steepSquares: number;
  lowSlopeSquares: number;
  /** "bands" = from Roofr's per-pitch table (preferred); "summary" = Roofr's
   *  pitched/flat totals (over-attributes 2/12 to flat); "total" = no split. */
  source: "bands" | "summary" | "total";
}

const toSquares = (areaSqFt: number) => Math.round((areaSqFt / 100) * 10) / 10;

/**
 * Split roof area into steep-slope (shingle/tile/metal) vs low-slope (membrane).
 * Prefers Roofr's per-pitch table at a configurable rise threshold; falls back to
 * Roofr's pitched/flat summary, then to the bare total (single-slope roof).
 */
export function splitByPitch(m: Measurements, lowSlopeRise: number = DEFAULT_LOW_SLOPE_RISE): SlopeSplit {
  const v = (x: number | null | undefined) => (x == null ? 0 : x);
  const bands = m.pitchBands;
  if (bands && bands.length) {
    let steep = 0;
    let low = 0;
    for (const b of bands) {
      const rise = parseInt(b.pitch, 10);
      if (Number.isNaN(rise)) continue;
      if (rise < lowSlopeRise) low += b.areaSqFt;
      else steep += b.areaSqFt;
    }
    return { steepAreaSqFt: steep, lowSlopeAreaSqFt: low, steepSquares: toSquares(steep), lowSlopeSquares: toSquares(low), source: "bands" };
  }
  if (m.pitchedAreaSqFt != null) {
    const steep = v(m.pitchedAreaSqFt);
    const low = v(m.flatAreaSqFt);
    return { steepAreaSqFt: steep, lowSlopeAreaSqFt: low, steepSquares: toSquares(steep), lowSlopeSquares: toSquares(low), source: "summary" };
  }
  const total = v(m.roofAreaSqFt) || v(m.totalSquares) * 100;
  return { steepAreaSqFt: total, lowSlopeAreaSqFt: 0, steepSquares: v(m.totalSquares) || toSquares(total), lowSlopeSquares: 0, source: "total" };
}

// Categories whose quantity is scaled by the roof-level waste factor.
// Categories whose quantity is scaled by the roof-level waste factor. These are
// area/length-driven primaries whose coefficient is a PRE-waste rate (Roofr's
// 0%-waste column). Accessories and tile ridge/rake — whose calibrated rates
// were derived from already-waste-included supplier orders — are NOT re-wasted.
const WASTEABLE = new Set([
  "Shingles", "Field Tile", "Panels", "Underlayment", "Ice & Water", "Ridge Cap", "Drip Edge",
]);

const DISCRETE_UNITS = new Set([
  "bundle", "roll", "piece", "each", "box", "tube", "bag", "panel", "sheet", "bucket", "gallon",
]);

function buildMetrics(m: Measurements, split: SlopeSplit): Record<string, number> {
  const v = (x: number | null | undefined) => (x == null ? 0 : x);
  const eaves = v(m.eavesLf);
  const rakes = v(m.rakesLf);
  const valleys = v(m.valleysLf);
  const hips = v(m.hipsLf);
  const ridges = v(m.ridgesLf);

  return {
    // Steep-slope area/squares drive every shingle/tile/metal rule. `split`
    // already resolved the steep vs low-slope areas (per-pitch table preferred).
    totalSquares: split.steepSquares,
    roofAreaSqFt: split.steepAreaSqFt,
    // Low-slope (membrane) metrics drive the roof-agnostic flat-roof rules; 0 when
    // there is no low-slope area, which makes every flat rule self-skip (base <= 0).
    flatAreaSqFt: split.lowSlopeAreaSqFt,
    flatSquares: split.lowSlopeSquares,
    facets: v(m.facets),
    eavesLf: eaves,
    rakesLf: rakes,
    valleysLf: valleys,
    hipsLf: hips,
    ridgesLf: ridges,
    ridgesHipsLf: v(m.ridgesHipsLf) || ridges + hips,
    dripEdgeLf: v(m.dripEdgeLf) || eaves + rakes,
    stepFlashingLf: v(m.stepFlashingLf),
    flashingLf: v(m.flashingLf),
    penetrations: v(m.penetrations),
    // Derived composites used by certain rules:
    starterLf: eaves + rakes,
    // Roofr applies ice & water along eaves + valleys + flashings.
    iceWaterLf: eaves + valleys + v(m.flashingLf) + v(m.stepFlashingLf),
    seamLf: ridges + hips + valleys + eaves + rakes,
  };
}

function rawQuantity(rule: ResolvedRule, metrics: Record<string, number>): number {
  const metric = rule.inputMetric ? metrics[rule.inputMetric] ?? 0 : 0;
  switch (rule.kind) {
    case "per_square":
    case "per_lf":
    case "per_count":
    case "per_facet":
      return metric * rule.value;
    case "squares_per_unit":
    case "lf_per_unit":
      return rule.value > 0 ? metric / rule.value : 0;
    case "fixed":
      return rule.value;
    case "waste_pct":
      return 0;
    default:
      return 0;
  }
}

function findMaterial(rule: ResolvedRule, roofType: RoofType, materials: PricedMaterial[]): PricedMaterial | undefined {
  const byCat = materials.filter(
    (mat) => mat.category === rule.category && (mat.roofType === roofType || mat.roofType === null),
  );
  if (byCat.length === 0) {
    // Fall back to any roof-agnostic material in the category.
    return materials.find((mat) => mat.category === rule.category);
  }
  // Prefer a unit match with the rule's output unit, else first active.
  return byCat.find((mat) => rule.unit && mat.unitType === rule.unit) ?? byCat[0];
}

export function generateEstimate(
  roofType: RoofType,
  measurements: Measurements,
  rules: ResolvedRule[],
  materials: PricedMaterial[],
  options: EstimateOptions = {},
): EstimateResult {
  const lowSlopeRise = options.lowSlopeRise ?? DEFAULT_LOW_SLOPE_RISE;
  const split = splitByPitch(measurements, lowSlopeRise);
  const metrics = buildMetrics(measurements, split);
  const warnings: string[] = [];

  if (split.lowSlopeAreaSqFt > 0) {
    const basis = split.source === "bands" ? `planes <${lowSlopeRise}/12` : "Roofr flat area";
    warnings.push(
      `Roof has ${Math.round(split.lowSlopeAreaSqFt)} sqft (${split.lowSlopeSquares} sq) low-slope area (${basis}): ` +
        `steep-slope material computed off ${Math.round(split.steepAreaSqFt)} sqft (${split.steepSquares} sq); ` +
        `low-slope section estimated with flat-roof membrane materials.`,
    );
  }

  const wasteRule = rules.find((r) => r.kind === "waste_pct");
  const wasteFactor =
    options.wasteFactorPct ??
    (measurements.suggestedWastePct ?? undefined) ??
    wasteRule?.value ??
    0.1;

  const items: MaterialLineDraft[] = [];
  // Track computed field-tile quantity so the screws rule can derive from it.
  let fieldTileQty = 0;

  for (const rule of rules) {
    if (rule.kind === "waste_pct") continue;
    if (rule.category === "Battens" && !options.battenInstall) continue;

    let base = 0;
    let calcDetail = "";

    if (rule.key.endsWith("panels.sqft_per_panel")) {
      // Metal panels: roof area ÷ (panel width × length).
      const widthIn = Number(rule.params?.panelWidthIn ?? 16);
      const lengthFt = Number(rule.params?.panelLengthFt ?? 12);
      const coverage = (widthIn / 12) * lengthFt; // sq ft per panel
      base = coverage > 0 ? metrics.roofAreaSqFt / coverage : 0;
      calcDetail = `${Math.round(metrics.roofAreaSqFt)} sq ft ÷ ${coverage.toFixed(1)} sq ft/panel`;
    } else if (rule.key.endsWith("screws.tiles_per_box")) {
      // Tile screws: derive from field tile count.
      const tilesPerBox = Number(rule.params?.tilesPerBox ?? rule.value ?? 250) || 250;
      base = fieldTileQty / tilesPerBox;
      calcDetail = `${fieldTileQty} tiles ÷ ${tilesPerBox} per box`;
    } else {
      base = rawQuantity(rule, metrics);
      const metricVal = rule.inputMetric ? metrics[rule.inputMetric] ?? 0 : rule.value;
      calcDetail = describeCalc(rule, metricVal);
    }

    if (base <= 0) continue; // nothing to order for this rule

    const applyWaste = WASTEABLE.has(rule.category);
    const qtyWithWaste = applyWaste ? base * (1 + wasteFactor) : base;

    const unit = rule.unit || "each";
    // round4 before ceil so float artifacts (e.g. 90 × 1.1 = 99.00000001)
    // don't push a whole extra unit onto the order.
    const rounded = DISCRETE_UNITS.has(unit) ? Math.ceil(round4(qtyWithWaste)) : round2(qtyWithWaste);

    if (rule.category === "Field Tile") fieldTileQty = rounded;

    const material = findMaterial(rule, roofType, materials);
    const unitCost = material?.unitCost ?? 0;
    if (!material) warnings.push(`No catalog material for "${rule.label}" (${rule.category}); priced at $0.`);
    else if (unitCost === 0) warnings.push(`Material "${material.name}" has no active price; priced at $0.`);

    const lineTotal = round2(rounded * unitCost);

    items.push({
      category: rule.category,
      name: material?.name ?? rule.label,
      sku: material?.sku ?? null,
      unitType: material?.unitType ?? unit,
      baseQuantity: round2(base),
      quantity: rounded,
      unitCost,
      lineTotal,
      wasteApplied: applyWaste,
      ruleKey: rule.key,
      calcNote: `${calcDetail}${applyWaste ? ` + ${Math.round(wasteFactor * 100)}% waste` : ""} → ${rounded} ${material?.unitType ?? unit}`,
      materialItemId: material?.id ?? null,
    });
  }

  // Stable ordering by category then name for predictable output.
  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));

  return {
    roofType,
    wasteFactorPct: wasteFactor,
    items,
    subtotal,
    total: subtotal,
    confidence: scoreConfidence(measurements, items, materials, options),
    warnings,
    measurementSnapshot: measurements,
  };
}

function describeCalc(rule: ResolvedRule, metricVal: number): string {
  switch (rule.kind) {
    case "per_square":
      return `${metricVal} sq × ${rule.value}`;
    case "per_lf":
      return `${metricVal} lf × ${rule.value}`;
    case "per_count":
    case "per_facet":
      return `${metricVal} × ${rule.value}`;
    case "squares_per_unit":
      return `${metricVal} sq ÷ ${rule.value} per unit`;
    case "lf_per_unit":
      return `${metricVal} lf ÷ ${rule.value} per unit`;
    case "fixed":
      return `fixed ${rule.value}`;
    default:
      return "";
  }
}

/** 0..1 confidence: blends parse confidence, measurement completeness, pricing coverage. */
function scoreConfidence(
  m: Measurements,
  items: MaterialLineDraft[],
  materials: PricedMaterial[],
  options: EstimateOptions,
): number {
  const hasSquares = (m.totalSquares ?? 0) > 0;
  const measureScore = hasSquares ? 1 : 0.3;
  const pricedShare = items.length === 0 ? 0 : items.filter((i) => i.unitCost > 0).length / items.length;
  const parse = options.parseConfidence ?? 0.8;
  const score = 0.4 * parse + 0.3 * measureScore + 0.3 * pricedShare;
  return Math.round(score * 100) / 100;
}
