import type { EstimateCostType, EstimateUnitType } from "@/generated/prisma/enums";
import type { EstimateResult, RoofType } from "@/lib/roofing/types";

/**
 * A roofing takeoff as a section of the sectioned estimate (audit roadmap MVP
 * 5): one line per material the engine ordered, priced at the price book's
 * unit cost, and one labor line per area at the company's rate per square
 * (ruled 2026-10-19). Every amount is a COST; the estimate's overhead and
 * margin make the price. Pure — the takeoff comes in already run.
 */
export type RoofSectionLine = {
  description: string;
  unitType: EstimateUnitType;
  quantity: number;
  unitPrice: number;
  costType: EstimateCostType;
  isOptional: boolean;
  notes: string | null;
};

export type RoofSection = {
  title: string;
  roofMeasurementId: string;
  items: RoofSectionLine[];
  materialCost: number;
  laborCost: number;
};

export const ROOF_TYPE_LABEL: Record<RoofType, string> = { SHINGLE: "Shingle", TILE: "Tile", METAL: "Metal" };

/** The engine's own units mapped onto the estimate's; anything else is counted "each" and keeps its unit in words. */
const UNIT_MAP: Record<string, EstimateUnitType> = { sq: "SQUARE", square: "SQUARE", lf: "LINEAR_FT", "linear ft": "LINEAR_FT", sheet: "SHEET", each: "EACH", "sq ft": "SQ_FT", sqft: "SQ_FT" };

export function estimateUnitFor(unit: string): { unitType: EstimateUnitType; inWords: string | null } {
  const u = unit.trim().toLowerCase();
  const mapped = UNIT_MAP[u];
  return mapped ? { unitType: mapped, inWords: null } : { unitType: "EACH", inWords: u || null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function roofSectionFromTakeoff(takeoff: EstimateResult, measurement: { id: string; label: string | null }): RoofSection {
  const materials: RoofSectionLine[] = takeoff.items.map((m) => {
    const { unitType, inWords } = estimateUnitFor(m.unitType);
    return {
      description: inWords ? `${m.name} (${inWords})` : m.name,
      unitType,
      quantity: m.quantity,
      unitPrice: m.unitCost,
      costType: "MATERIAL",
      isOptional: false,
      notes: m.calcNote ?? null,
    };
  });
  const labor: RoofSectionLine[] = takeoff.labor.map((l) => ({
    description: l.area === "low-slope" ? "Labor — low-slope section" : `Labor — ${ROOF_TYPE_LABEL[takeoff.roofType].toLowerCase()} roof`,
    unitType: "SQUARE",
    quantity: l.squares,
    unitPrice: l.ratePerSquare,
    costType: "LABOR",
    isOptional: false,
    notes: `${l.squares} sq × $${l.ratePerSquare}/sq`,
  }));
  const squares = round2(takeoff.labor.reduce((s, l) => s + l.squares, 0));
  return {
    title: `Roofing — ${ROOF_TYPE_LABEL[takeoff.roofType]}${squares > 0 ? ` (${squares} sq)` : ""}${measurement.label ? ` · ${measurement.label}` : ""}`,
    roofMeasurementId: measurement.id,
    items: [...labor, ...materials],
    materialCost: takeoff.subtotal,
    laborCost: round2(takeoff.labor.reduce((s, l) => s + l.lineTotal, 0)),
  };
}
