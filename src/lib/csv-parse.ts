export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      obj[header[i]] = (r[i] || "").trim();
    }
    return obj;
  });
}
