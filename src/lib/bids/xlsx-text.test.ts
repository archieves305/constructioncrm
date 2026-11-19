import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { xlsxToText } from "./xlsx-text";

describe("xlsxToText", () => {
  it("reads every sheet with cell addresses and computed formula values", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bid");
    ws.getCell("A1").value = "Drywall";
    ws.getCell("B1").value = 100000;
    ws.getCell("A2").value = "Plumbing";
    ws.getCell("B2").value = 50000;
    ws.getCell("B3").value = { formula: "B1+B2", result: 150000 };
    wb.addWorksheet("Notes").getCell("C5").value = "Excludes permits";
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await xlsxToText(bytes);
    expect(r.sheets).toBe(2);
    expect(r.text).toContain("## Bid\nA1=Drywall | B1=100000");
    expect(r.text).toContain("B3=150000");
    expect(r.text).toContain("## Notes\nC5=Excludes permits");
    expect(r.truncated).toBe(false);
  });
});
