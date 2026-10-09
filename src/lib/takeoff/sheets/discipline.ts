import type { PlanDisciplineName } from "../types";

/** The discipline a sheet-list column names ("ARCHITECTURE", "PLUMBING", "LOW VOLTAGE"). */
export function disciplineFromWord(word: string): PlanDisciplineName | null {
  const w = word.trim().toUpperCase();
  if (!w) return null;
  if (/^ARCH/.test(w)) return "ARCHITECTURAL";
  if (/^STRUCT/.test(w)) return "STRUCTURAL";
  if (/^CIVIL/.test(w)) return "CIVIL";
  if (/^PLUMB/.test(w)) return "PLUMBING";
  if (/^MECH/.test(w) || /^HVAC/.test(w)) return "MECHANICAL";
  if (/^ELEC/.test(w)) return "ELECTRICAL";
  if (/^GAS/.test(w)) return "GAS";
  if (/^LANDSC/.test(w)) return "LANDSCAPE";
  if (/^LOW\s*VOLT/.test(w) || w === "LV") return "LOW_VOLTAGE";
  if (/^IRRIG/.test(w)) return "IRRIGATION";
  if (/^GENERAL/.test(w) || /^COVER/.test(w) || /^TITLE/.test(w)) return "GENERAL";
  return null;
}

const PREFIX: Record<string, PlanDisciplineName> = {
  A: "ARCHITECTURAL", AD: "ARCHITECTURAL", AS: "ARCHITECTURAL", AE: "ARCHITECTURAL",
  S: "STRUCTURAL", SK: "STRUCTURAL",
  C: "CIVIL", CU: "CIVIL", CG: "CIVIL",
  P: "PLUMBING", PL: "PLUMBING", PD: "PLUMBING",
  M: "MECHANICAL", MH: "MECHANICAL", H: "MECHANICAL",
  E: "ELECTRICAL", EL: "ELECTRICAL", EP: "ELECTRICAL",
  LV: "LOW_VOLTAGE", T: "LOW_VOLTAGE", TC: "LOW_VOLTAGE",
  IP: "IRRIGATION", IR: "IRRIGATION",
  L: "LANDSCAPE", LA: "LANDSCAPE", LP: "LANDSCAPE",
  FP: "MECHANICAL",
};

/** Title words that settle an ambiguous prefix (G is gas on this set, general on others). */
function disciplineFromTitle(title: string): PlanDisciplineName | null {
  const t = title.toUpperCase();
  if (/\bGAS\b/.test(t)) return "GAS";
  if (/PLUMB|SANITARY|\bDWV\b|CW-HW|DOMESTIC WATER|WATER PLAN|RISER/.test(t)) return "PLUMBING";
  if (/HVAC|MECHANICAL|DUCT/.test(t)) return "MECHANICAL";
  if (/ELECTRIC|LIGHTING|RECEPTACLE|PANEL SCHEDULE/.test(t)) return "ELECTRICAL";
  if (/IRRIGATION/.test(t)) return "IRRIGATION";
  if (/LANDSCAPE|PLANTING/.test(t)) return "LANDSCAPE";
  if (/STRUCTURAL|FOUNDATION|FRAMING/.test(t)) return "STRUCTURAL";
  if (/CIVIL|GRADING|PAVING|STORMWATER|UTILIT/.test(t)) return "CIVIL";
  if (/GENERAL NOTES|COVER|TITLE SHEET|INDEX|SPECIFICATION/.test(t)) return "GENERAL";
  if (/FLOOR PLAN|ROOF|ELEVATION|SECTION|DOOR SCHEDULE|WINDOW|RCP|REFLECTED CEILING|SITE PLAN|DETAIL/.test(t)) return "ARCHITECTURAL";
  return null;
}

/** The discipline of a sheet from its number's prefix, settled by the title where the prefix is ambiguous. */
export function disciplineFor(sheetNumber: string | null, title: string | null): PlanDisciplineName {
  const prefix = sheetNumber ? (sheetNumber.toUpperCase().match(/^([A-Z]{1,3})/)?.[1] ?? "") : "";
  const fromTitle = title ? disciplineFromTitle(title) : null;
  if (prefix === "G") return fromTitle ?? "GENERAL";
  if (prefix && PREFIX[prefix]) {
    // a title can only sharpen an ambiguous prefix, never override a clear one — except GAS on a P sheet
    if (PREFIX[prefix] === "PLUMBING" && fromTitle === "GAS") return "GAS";
    return PREFIX[prefix];
  }
  return fromTitle ?? "UNKNOWN";
}
