import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PageText } from "../types";
import { classifyPage, documentSheetList } from "./classify";
import { disciplineFor, disciplineFromWord } from "./discipline";
import { findScaleTexts, parseScaleText, scaleForSheet } from "./scale";
import { parseSheetList } from "./sheet-list";
import { linesOf, looksLikeSheetNumber } from "./text-lines";
import { parseTitleBlock } from "./title-block";

const fixture = (name: string): PageText => JSON.parse(readFileSync(path.join(__dirname, "..", "__fixtures__", `${name}.text.json`), "utf8"));
const A00 = fixture("a00");
const A10 = fixture("a10");
const P01 = fixture("p01");
const P02 = fixture("p02");
const G01 = fixture("g01");
const A24 = fixture("a24");

describe("scale text", () => {
  it("reads architectural, engineering and ratio scales into points per foot", () => {
    expect(parseScaleText(`1/4" = 1'-0"`)?.ptPerFt).toBe(18);
    expect(parseScaleText(`1/8"=1'`)?.ptPerFt).toBe(9);
    expect(parseScaleText(`3/32" = 1'-0"`)?.ptPerFt).toBe(6.75);
    expect(parseScaleText(`1 1/2" = 1'-0"`)?.ptPerFt).toBe(108);
    expect(parseScaleText(`3" = 1'-0"`)?.ptPerFt).toBe(216);
    expect(parseScaleText(`1" = 20'`)?.ptPerFt).toBe(3.6);
    expect(parseScaleText(`1" = 20'-0"`)?.ptPerFt).toBe(3.6);
    expect(parseScaleText("1:100")?.ptPerFt).toBe(8.64);
    expect(parseScaleText("NTS")).toEqual({ label: "NTS", ptPerFt: null, nts: true });
    expect(parseScaleText("N.T.S.")?.nts).toBe(true);
    expect(parseScaleText("NOT TO SCALE")?.nts).toBe(true);
    expect(parseScaleText("ROOF PLAN & DET.")).toBeNull();
    expect(parseScaleText("16'-8 11/16\"")).toBeNull();
  });

  it("finds the roof plan's single scale and the title sheet's NTS", () => {
    const roof = scaleForSheet(A10.items, A10.widthPt, A10.heightPt);
    expect(roof.scaleText).toBe(`1/4" = 1'-0"`);
    expect(roof.ptPerFt).toBe(18);
    expect(roof.others).toEqual([]);
    const san = scaleForSheet(P02.items, P02.widthPt, P02.heightPt);
    expect(san.ptPerFt).toBe(18);
    const specs = scaleForSheet(A24.items, A24.widthPt, A24.heightPt);
    expect(specs.scaleText).toBeNull();
    expect(findScaleTexts(A24.items).every((h) => h.nts)).toBe(true);
  });

  it("names the other scales when a sheet mixes them", () => {
    const gas = scaleForSheet(G01.items, G01.widthPt, G01.heightPt);
    expect(gas.scaleText).toBe(`3" = 1'-0"`);
    expect(gas.others.length).toBeGreaterThan(0);
  });
});

describe("discipline", () => {
  it("maps column words and sheet prefixes, settling G by the title", () => {
    expect(disciplineFromWord("ARCHITECTURE")).toBe("ARCHITECTURAL");
    expect(disciplineFromWord("PLUMBING")).toBe("PLUMBING");
    expect(disciplineFromWord("LANDSCAPE")).toBe("LANDSCAPE");
    expect(disciplineFromWord("No.")).toBeNull();
    expect(disciplineFor("A-10", "GENERAL ROOF PLAN")).toBe("ARCHITECTURAL");
    expect(disciplineFor("P-02", "SANITARY - 1ST FL")).toBe("PLUMBING");
    expect(disciplineFor("G-01", "GAS NOTES AND FLOOR PLAN")).toBe("GAS");
    expect(disciplineFor("G-001", "GENERAL NOTES")).toBe("GENERAL");
    expect(disciplineFor("LV-01", "1ST FLOOR LV")).toBe("LOW_VOLTAGE");
    expect(disciplineFor("IP-01", "IRRIGATION PLAN")).toBe("IRRIGATION");
    expect(disciplineFor("S-1.1", "FOUNDATION DETAILS")).toBe("STRUCTURAL");
    expect(disciplineFor(null, "HVAC SCHEDULES")).toBe("MECHANICAL");
    expect(disciplineFor(null, null)).toBe("UNKNOWN");
  });
});

describe("text lines and sheet numbers", () => {
  it("rebuilds reading lines and recognises sheet numbers", () => {
    const lines = linesOf(A10.items);
    expect(lines.some((l) => l.text.includes("GENERAL ROOF PLAN"))).toBe(true);
    expect(looksLikeSheetNumber("A-10")).toBe(true);
    expect(looksLikeSheetNumber("S-1.1")).toBe(true);
    expect(looksLikeSheetNumber("LV-01")).toBe(true);
    expect(looksLikeSheetNumber("E003")).toBe(true);
    expect(looksLikeSheetNumber("WC-1")).toBe(true); // a fixture tag looks like one — the list header keeps it out
    expect(looksLikeSheetNumber("3310")).toBe(false);
    expect(looksLikeSheetNumber("ROOF")).toBe(false);
  });
});

describe("sheet list on A-00", () => {
  const list = parseSheetList(A00.items);
  it("finds every sheet of the project with its discipline and title", () => {
    expect(list.found).toBe(true);
    expect(list.entries.length).toBeGreaterThanOrEqual(60);
    const by = Object.fromEntries(list.entries.map((e) => [e.sheetNumber, e]));
    expect(by["A-10"]).toEqual({ sheetNumber: "A-10", title: "GENERAL ROOF PLAN", discipline: "ARCHITECTURAL" });
    expect(by["P-02"]).toEqual({ sheetNumber: "P-02", title: "SANITARY - 1ST FL", discipline: "PLUMBING" });
    expect(by["G-02"]).toEqual({ sheetNumber: "G-02", title: "GAS ISOMETRIC", discipline: "PLUMBING" });
    expect(by["LV-01"].discipline).toBe("ELECTRICAL");
    expect(by["S-1.1"].title).toBe("FOUNDATION DETAILS");
    expect(by["A-00"].title).toBe("TITLE SHEET");
    expect(by["C-03"].title).toBe("UTILITIES PLANS");
  });
  it("does not read the title block's company text into a title", () => {
    expect(parseSheetList(A00.items).entries.find((e) => e.sheetNumber === "A-11")?.title).toBe("NORTH & SOUTH ELEVATIONS");
  });
  it("is not fooled by a sheet with no list", () => {
    expect(parseSheetList(A10.items).found).toBe(false);
    expect(parseSheetList(P02.items).found).toBe(false);
  });
});

describe("title block", () => {
  it("reads the sheet number and title from the right strip", () => {
    const roof = parseTitleBlock(A10.items, A10.widthPt, A10.heightPt);
    expect(roof.sheetNumber).toBe("A-10");
    expect(roof.sheetNumberConfidence).toBeGreaterThanOrEqual(0.9);
    expect(roof.title).toBe("GENERAL ROOF PLAN");
    const san = parseTitleBlock(P02.items, P02.widthPt, P02.heightPt);
    expect(san.sheetNumber).toBe("P-02");
    expect(san.title).toBe("SANITARY - 1ST FL");
    const notes = parseTitleBlock(P01.items, P01.widthPt, P01.heightPt);
    expect(notes.sheetNumber).toBe("P-01");
    expect(parseTitleBlock(A00.items, A00.widthPt, A00.heightPt).sheetNumber).toBe("A-00");
  });
});

describe("classify", () => {
  it("indexes the roof plan and the sanitary plan from the title block checked against the sheet list", () => {
    const list = documentSheetList([A00, A10]);
    expect(list.found).toBe(true);
    const roof = classifyPage(A10, list);
    expect(roof).toMatchObject({ sheetNumber: "A-10", title: "GENERAL ROOF PLAN", discipline: "ARCHITECTURAL", scaleText: `1/4" = 1'-0"` });
    expect(roof.confidence).toBeGreaterThanOrEqual(0.9);
    expect(roof.sources.title).toBe("sheet_list");
    const gas = classifyPage(G01, list);
    expect(gas.sheetNumber).toBe("G-01");
    expect(gas.discipline).toBe("PLUMBING"); // the sheet list files gas under plumbing, and the list wins
    const san = classifyPage(P02, { found: false, entries: [] });
    expect(san).toMatchObject({ sheetNumber: "P-02", discipline: "PLUMBING" });
    expect(san.sources.title).toBe("title_block");
  });
});
