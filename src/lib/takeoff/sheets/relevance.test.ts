import { describe, expect, it } from "vitest";
import { proposeSheets, type SheetForRelevance } from "./relevance";

const S = (id: string, sheetNumber: string, title: string, discipline: SheetForRelevance["discipline"]): SheetForRelevance => ({ id, sheetNumber, title, discipline });
const SET: SheetForRelevance[] = [
  S("a00", "A-00", "TITLE SHEET", "ARCHITECTURAL"), S("a04", "A-04", "FIRST FLOOR PLAN", "ARCHITECTURAL"), S("a08", "A-08", "MAIN ROOF DRAINAGE PLAN", "ARCHITECTURAL"),
  S("a10", "A-10", "GENERAL ROOF PLAN", "ARCHITECTURAL"), S("a11", "A-11", "NORTH & SOUTH ELEVATIONS", "ARCHITECTURAL"), S("a15", "A-15", "ARCHITECTURAL WALL SECTIONS", "ARCHITECTURAL"),
  S("a16", "A-16", "RCP FIRST FLOOR AND DETAILS", "ARCHITECTURAL"), S("a24", "A-24", "GENERAL NOTES AND SPECIFICATIONS", "ARCHITECTURAL"), S("c03", "C-03", "UTILITIES PLANS", "CIVIL"),
  S("g01", "G-01", "GAS NOTES AND FLOOR PLAN", "PLUMBING"), S("g02", "G-02", "GAS ISOMETRIC", "PLUMBING"), S("p01", "P-01", "PLUMBING NOTES AND SCHEDULES", "PLUMBING"),
  S("p02", "P-02", "SANITARY - 1ST FL", "PLUMBING"), S("p04", "P-04", "SANITARY - ISOMETRIC", "PLUMBING"), S("p05", "P-05", "CW-HW - 1ST FL", "PLUMBING"), S("e03", "E-03", "1ST FLOOR RECEPTACLES PLANS", "ELECTRICAL"),
];

describe("relevant sheets", () => {
  it("proposes the roof plans, sections and notes for roofing", () => {
    const r = Object.fromEntries(proposeSheets("ROOFING", SET).map((p) => [p.id, p.role]));
    expect(r).toEqual({ a08: "roof_plan", a10: "roof_plan", a11: "roof_details", a15: "roof_details", a16: "roof_details", a24: "notes" });
  });
  it("proposes the plumbing and gas sheets, the floor plans and the utilities for plumbing", () => {
    const r = Object.fromEntries(proposeSheets("PLUMBING", SET).map((p) => [p.id, p.role]));
    expect(r).toEqual({ a04: "floor_plan", c03: "site", g01: "gas_plan", g02: "gas_plan", p01: "schedule", p02: "dwv_plan", p04: "riser", p05: "water_plan" });
  });
});
