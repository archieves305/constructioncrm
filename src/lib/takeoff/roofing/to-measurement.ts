/**
 * A roofing takeoff read as a roof measurement, so the roofing engine and the
 * estimate builder price a roof measured from plans exactly as they price a
 * Roofr report. Pure — the rows come in already loaded.
 *
 * Only rows a person has looked at are counted, and only on the sheets the
 * person ticks: a set that draws the same roof on two sheets would otherwise
 * count it twice. A plan's area is horizontal; a sloped area is grown by its
 * pitch before it reaches a pitch band. A value with no rows stays null.
 */
import type { MeasurementValues } from "@/lib/roofing/measurements";
import type { PitchBand } from "@/lib/roofing/types";

export type TakeoffRowInput = {
  id: string;
  planSheetId: string;
  sheetNumber: string | null;
  metricKey: string;
  label: string;
  valueRaw: number;
  attributes: Record<string, unknown> | null;
  origin: "AI" | "MANUAL" | "TEXT_LABEL" | "SCHEDULE";
  reviewStatus: "AI_GENERATED" | "REVIEWED" | "MODIFIED" | "APPROVED" | "EXCLUDED" | "NEEDS_CLARIFICATION";
};

export type LeftOutReason = "not_reviewed" | "excluded" | "needs_clarification" | "sheet_not_chosen" | "not_used";

export type PlanMeasurement = {
  values: MeasurementValues;
  pitchBands: PitchBand[] | null;
  counted: number;
  leftOut: { id: string; label: string; sheetNumber: string | null; reason: LeftOutReason }[];
  /** Drains, scuppers, gutters and downspouts: measured, but no takeoff rule reads them yet. */
  notPriced: { label: string; value: number; unit: "EA" | "LF" }[];
  warnings: string[];
  /** Share of the chosen sheets' rows a person has looked at, 0..1. */
  reviewedShare: number;
};

/** Below this rise (per 12) an area is low-slope — the engine's own default threshold. */
export const LOW_SLOPE_RISE = 2;

const REVIEWED = new Set(["REVIEWED", "MODIFIED", "APPROVED"]);

/** Which measurement field each length or count adds to. Areas are handled on their own. */
const SUMS: Record<string, keyof MeasurementValues> = {
  "roof.eave": "eavesLf",
  "roof.rake": "rakesLf",
  "roof.ridge": "ridgesLf",
  "roof.hip": "hipsLf",
  "roof.valley": "valleysLf",
  "roof.parapet": "flashingLf",
  "roof.wall": "flashingLf",
  "roof.penetration": "penetrations",
  "roof.vent": "penetrations",
  "roof.curb": "penetrations",
  "roof.skylight": "skylights",
};

const NOT_PRICED: Record<string, { label: string; unit: "EA" | "LF" }> = {
  "roof.drain": { label: "Primary drains", unit: "EA" },
  "roof.overflow": { label: "Overflow / emergency drains", unit: "EA" },
  "roof.scupper": { label: "Scuppers", unit: "EA" },
  "roof.gutter": { label: "Gutter", unit: "LF" },
  "roof.downspout": { label: "Downspouts", unit: "EA" },
};

const AREAS = new Set(["roof.area", "roof.cricket"]);

/**
 * The rise per 12 of a slope as plans write it: `1/4" PER FT`, `1/8":12"`,
 * `4:12`, `4/12`, `4 IN 12`, `2%`. Null when the text says nothing usable.
 */
export function parseSlope(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toUpperCase().replace(/\s+/g, " ");
  // inches per foot: "1/4" PER FT", "1/4 IN/FT", "1/8":12"" (a fraction is never a pitch)
  const perFoot = t.match(/(?:(\d+)\s*-\s*|(\d+)\s+)?(\d+)\s*\/\s*(\d+)\s*(?:"|IN(?:CH(?:ES)?)?)?\s*(?:PER|\/|:)\s*(?:FT|FOOT|'|1'|12)/);
  if (perFoot && Number(perFoot[4]) !== 12) {
    const whole = Number(perFoot[1] ?? perFoot[2] ?? 0);
    const den = Number(perFoot[4]);
    if (den > 0) return whole + Number(perFoot[3]) / den;
  }
  const pitch = t.match(/(\d+(?:\.\d+)?)\s*(?:\/|:|IN)\s*12\b/);
  if (pitch) return Number(pitch[1]);
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return (12 * Number(pct[1])) / 100;
  return null;
}

/** Sloped area from a plan's horizontal area. */
export function slopedArea(planArea: number, risePer12: number): number {
  return planArea * Math.sqrt(1 + (risePer12 / 12) ** 2);
}

/** The pitch band a rise falls in. A low-slope rise never rounds up into a steep band. */
export function bandOf(rise: number): string {
  return `${rise < LOW_SLOPE_RISE ? Math.floor(rise) : Math.round(rise)}/12`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function leftOutReason(r: TakeoffRowInput, chosen: Set<string>): LeftOutReason | null {
  if (!chosen.has(r.planSheetId)) return "sheet_not_chosen";
  if (r.reviewStatus === "EXCLUDED") return "excluded";
  if (r.reviewStatus === "NEEDS_CLARIFICATION") return "needs_clarification";
  if (r.origin !== "MANUAL" && !REVIEWED.has(r.reviewStatus)) return "not_reviewed";
  if (!AREAS.has(r.metricKey) && !SUMS[r.metricKey] && !NOT_PRICED[r.metricKey]) return "not_used";
  return null;
}

export function takeoffToMeasurement(rows: TakeoffRowInput[], options: { sheetIds: string[]; defaultRise: number }): PlanMeasurement {
  const chosen = new Set(options.sheetIds);
  const values: Record<string, number | null> = {};
  const bands = new Map<string, number>();
  const notPriced = new Map<string, number>();
  const leftOut: PlanMeasurement["leftOut"] = [];
  const areaSheets = new Map<string, string>();
  const warnings: string[] = [];
  let counted = 0;
  let onChosen = 0;
  let reviewedOnChosen = 0;
  let unsloped = 0;

  for (const r of rows) {
    if (chosen.has(r.planSheetId) && r.reviewStatus !== "EXCLUDED") {
      onChosen++;
      if (r.origin === "MANUAL" || REVIEWED.has(r.reviewStatus)) reviewedOnChosen++;
    }
    const reason = leftOutReason(r, chosen);
    if (reason) {
      if (reason !== "sheet_not_chosen") leftOut.push({ id: r.id, label: r.label, sheetNumber: r.sheetNumber, reason });
      continue;
    }
    counted++;
    if (AREAS.has(r.metricKey)) {
      const slope = parseSlope(typeof r.attributes?.slope === "string" ? r.attributes.slope : null);
      if (slope == null) unsloped++;
      const rise = slope ?? options.defaultRise;
      const band = bandOf(rise);
      bands.set(band, (bands.get(band) ?? 0) + slopedArea(r.valueRaw, rise));
      if (r.metricKey === "roof.area") areaSheets.set(r.planSheetId, r.sheetNumber ?? "a sheet");
      continue;
    }
    const np = NOT_PRICED[r.metricKey];
    if (np) {
      notPriced.set(r.metricKey, (notPriced.get(r.metricKey) ?? 0) + r.valueRaw);
      continue;
    }
    const field = SUMS[r.metricKey] as string;
    values[field] = (values[field] ?? 0) + r.valueRaw;
  }

  for (const k of Object.keys(values)) {
    const v = values[k] as number;
    values[k] = k === "penetrations" || k === "skylights" ? Math.round(v) : round2(v);
  }

  const pitchBands: PitchBand[] | null = bands.size
    ? [...bands.entries()].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)).map(([pitch, area]) => ({ pitch, areaSqFt: round2(area) }))
    : null;
  if (pitchBands) {
    const total = pitchBands.reduce((s, b) => s + b.areaSqFt, 0);
    const low = pitchBands.filter((b) => parseInt(b.pitch, 10) < LOW_SLOPE_RISE).reduce((s, b) => s + b.areaSqFt, 0);
    values.roofAreaSqFt = round2(total);
    values.totalSquares = round2(total / 100);
    values.flatAreaSqFt = round2(low);
    values.pitchedAreaSqFt = round2(total - low);
    const main = pitchBands.reduce((a, b) => (b.areaSqFt > a.areaSqFt ? b : a));
    (values as MeasurementValues).predominantPitch = main.pitch;
  }

  if (areaSheets.size > 1) {
    warnings.push(`Roof area is counted on ${areaSheets.size} sheets (${[...areaSheets.values()].join(", ")}). If they draw the same roof, tick only one.`);
  }
  if (unsloped > 0) warnings.push(`${unsloped} area${unsloped === 1 ? " has" : "s have"} no slope on the plans; counted at ${bandOf(options.defaultRise)}.`);
  if (!pitchBands) warnings.push("No reviewed roof area on the chosen sheets.");
  const notReviewed = leftOut.filter((l) => l.reason === "not_reviewed").length;
  if (notReviewed > 0) warnings.push(`${notReviewed} AI proposal${notReviewed === 1 ? " is" : "s are"} not reviewed yet and left out.`);

  return {
    values: values as MeasurementValues,
    pitchBands,
    counted,
    leftOut,
    notPriced: [...notPriced.entries()].map(([key, value]) => ({ label: NOT_PRICED[key].label, value: NOT_PRICED[key].unit === "EA" ? Math.round(value) : round2(value), unit: NOT_PRICED[key].unit })),
    warnings,
    reviewedShare: onChosen ? round2(reviewedOnChosen / onChosen) : 0,
  };
}
