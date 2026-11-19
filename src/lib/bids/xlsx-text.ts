import ExcelJS from "exceljs";

/**
 * A spreadsheet estimate as text the model can read and cite: one line per
 * row, each cell as `A1=value`, under a `## Sheet` heading. Formulas give
 * their last computed value. Capped so a huge workbook cannot fill the
 * request; the cap is reported so the review says the read was partial.
 */
export const XLSX_TEXT_CAP = 150_000;

function cellValue(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellValue(o.result as ExcelJS.CellValue);
    if (o.text !== undefined) return String(o.text);
    return "";
  }
  return String(v);
}

export async function xlsxToText(bytes: Buffer): Promise<{ text: string; truncated: boolean; sheets: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const out: string[] = [];
  let size = 0;
  let truncated = false;
  wb.eachSheet((ws) => {
    if (truncated) return;
    out.push(`## ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (truncated) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cellValue(cell.value).replace(/\s+/g, " ").trim();
        if (v) cells.push(`${cell.address}=${v}`);
      });
      if (!cells.length) return;
      const line = cells.join(" | ");
      size += line.length + 1;
      if (size > XLSX_TEXT_CAP) {
        truncated = true;
        return;
      }
      out.push(line);
    });
  });
  return { text: out.join("\n"), truncated, sheets: wb.worksheets.length };
}
