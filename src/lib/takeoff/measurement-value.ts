import { polygonArea, polylineLength, type Pt } from "./geometry";
import { toFt, toSqFt } from "./geometry/measure";
import type { MeasurementKindName, Unit } from "./metrics";
import { UNIT_FOR_KIND } from "./metrics";

/**
 * The one place a measurement's number comes from. Client-safe: the viewer
 * uses it for the live readout while drawing, the server for the stored value.
 */
export type Geometry = { points: Pt[] };

export function minPoints(kind: MeasurementKindName): number {
  return kind === "AREA" ? 3 : kind === "LENGTH" ? 2 : 1;
}

export function computeValue(kind: MeasurementKindName, geometry: Geometry, ptPerFt: number | null): { valueRaw: number; unit: Unit } | null {
  const pts = geometry.points;
  if (pts.length < minPoints(kind)) return null;
  if (kind === "COUNT") return { valueRaw: 1, unit: "EA" };
  if (!ptPerFt || ptPerFt <= 0) return null;
  if (kind === "AREA") return { valueRaw: round2(toSqFt(polygonArea(pts), ptPerFt)), unit: UNIT_FOR_KIND.AREA };
  return { valueRaw: round2(toFt(polylineLength(pts), ptPerFt)), unit: UNIT_FOR_KIND.LENGTH };
}

export function formatValue(value: number, unit: Unit): string {
  if (unit === "EA") return `${Math.round(value)}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: unit === "SF" ? 0 : 1 })} ${unit}`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
