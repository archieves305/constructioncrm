import ExcelJS from "exceljs";

export type ParsedBudgetRow = {
  category: string | null;
  name: string;
  amount: number;
};

/**
 * Parse a number out of a spreadsheet cell, tolerating "$1,200.50", "(800)"
 * (accounting negative), and plain numbers. Returns null when not numeric.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // ExcelJS rich text / hyperlink / formula result objects.
    const o = value as { text?: unknown; result?: unknown };
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
  }
  return String(value).trim();
}

/**
 * Turn a list of row cell-arrays into budget rows. Expected columns are
 * positional: [Category, Line item, Budget]. A 2-column sheet [Line item,
 * Budget] is tolerated. Rules:
 *  - The amount is the last numeric cell in the row.
 *  - Text cells before it: 2+ → first is category, the rest joined is the name;
 *    1 → name (no category).
 *  - Rows with no numeric amount or no name are skipped (this also drops a
 *    header row like "Category,Line item,Budget").
 */
function rowsToBudget(rows: string[][] | unknown[][]): ParsedBudgetRow[] {
  const out: ParsedBudgetRow[] = [];
  for (const raw of rows) {
    const cells = raw.map((c) => c);
    // Find the last cell that parses as a number → that's the amount.
    let amountIdx = -1;
    let amount = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      const n = toNumber(cells[i]);
      if (n !== null && cellText(cells[i]) !== "") {
        amountIdx = i;
        amount = n;
        break;
      }
    }
    if (amountIdx === -1) continue;

    const textCells = cells
      .slice(0, amountIdx)
      .map((c) => cellText(c))
      .filter((t) => t.length > 0);
    if (textCells.length === 0) continue;

    let category: string | null = null;
    let name: string;
    if (textCells.length >= 2) {
      category = textCells[0];
      name = textCells.slice(1).join(" – ");
    } else {
      name = textCells[0];
    }
    out.push({ category, name, amount });
  }
  return out;
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by \n
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse an uploaded budget spreadsheet (.xlsx/.xls or .csv) into budget rows.
 * Throws on an unreadable/unsupported file.
 */
export async function parseBudget(
  buffer: Buffer,
  filename: string,
): Promise<ParsedBudgetRow[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    return rowsToBudget(parseCsv(buffer.toString("utf8")));
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = new ExcelJS.Workbook();
    // Pass an ArrayBuffer (exceljs accepts it) to avoid Node Buffer-type churn.
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    await wb.xlsx.load(ab);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: unknown[][] = [];
    ws.eachRow((row) => {
      // row.values is 1-indexed with a leading undefined; drop it.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values);
    });
    return rowsToBudget(rows);
  }
  throw new Error("Unsupported file type — upload .xlsx or .csv");
}
