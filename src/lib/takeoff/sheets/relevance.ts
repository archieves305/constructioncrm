import type { TradeName } from "../metrics";
import type { PlanDisciplineName } from "../types";

/**
 * Which sheets a trade's takeoff draws on, proposed from the index: a person
 * confirms or changes the selection before anything is measured. Never the
 * trade's own sheets alone — a roof is in the sections, a plumbing fixture
 * count is on the architectural floor plans.
 */
export type SheetForRelevance = { id: string; sheetNumber: string | null; title: string | null; discipline: PlanDisciplineName };
export type SheetRole = "roof_plan" | "roof_details" | "floor_plan" | "dwv_plan" | "water_plan" | "riser" | "schedule" | "gas_plan" | "notes" | "site";

const title = (s: SheetForRelevance) => (s.title ?? "").toUpperCase();

export function proposeSheets(trade: TradeName, sheets: readonly SheetForRelevance[]): { id: string; role: SheetRole }[] {
  const out: { id: string; role: SheetRole }[] = [];
  for (const s of sheets) {
    const t = title(s);
    if (trade === "ROOFING") {
      if (/ROOF/.test(t) && /PLAN/.test(t)) out.push({ id: s.id, role: "roof_plan" });
      else if (/ROOF/.test(t)) out.push({ id: s.id, role: "roof_details" });
      else if (/WALL SECTION|SECTION|ELEVATION|DETAIL/.test(t) && s.discipline === "ARCHITECTURAL") out.push({ id: s.id, role: "roof_details" });
      else if (/GENERAL NOTES|SPECIFICATION/.test(t)) out.push({ id: s.id, role: "notes" });
      else if (s.discipline === "STRUCTURAL" && /ROOF/.test(t)) out.push({ id: s.id, role: "roof_details" });
    } else {
      if (s.discipline === "PLUMBING" || s.discipline === "GAS") {
        if (/GAS/.test(t)) out.push({ id: s.id, role: "gas_plan" });
        else if (/SCHEDULE|NOTES/.test(t)) out.push({ id: s.id, role: "schedule" });
        else if (/ISOMETRIC|RISER/.test(t)) out.push({ id: s.id, role: "riser" });
        else if (/SANITARY|WASTE|DWV|SEWER/.test(t)) out.push({ id: s.id, role: "dwv_plan" });
        else if (/WATER|CW|HW|SUPPLY/.test(t)) out.push({ id: s.id, role: "water_plan" });
        else out.push({ id: s.id, role: "dwv_plan" });
      } else if (s.discipline === "ARCHITECTURAL" && /FLOOR PLAN/.test(t) && !/RCP|CEILING/.test(t)) out.push({ id: s.id, role: "floor_plan" });
      else if (s.discipline === "CIVIL" && /UTILIT/.test(t)) out.push({ id: s.id, role: "site" });
      else if (/PLUMBING|SANITARY/.test(t)) out.push({ id: s.id, role: "dwv_plan" });
    }
  }
  return out;
}
