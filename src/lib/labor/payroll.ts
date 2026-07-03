import { toCsv } from "@/lib/csv";
import { addDays } from "./dates";

// Payroll-export shaping: one row per worker per distinct regular rate for
// the week (a mid-week rate change yields two rows so gross always equals
// hours × the rate actually snapshotted on each entry).

export type PayrollEntry = {
  personnelId: string;
  name: string;
  employmentType: string;
  entity: string | null;
  workDate: string; // YYYY-MM-DD
  regularHours: number;
  otHours: number;
  regularRate: number;
  otRate: number;
  totalCost: number;
};

export type PayrollRow = {
  name: string;
  employmentType: string;
  entity: string;
  regularRate: number;
  dayHours: number[]; // 7 buckets from weekStart
  regularHours: number;
  otHours: number;
  gross: number;
};

export function buildPayrollRows(
  entries: PayrollEntry[],
  weekStart: string,
): PayrollRow[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const rows = new Map<string, PayrollRow>();

  for (const e of entries) {
    const di = dayIndex.get(e.workDate);
    if (di === undefined) continue;
    const key = `${e.personnelId}|${e.regularRate}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        name: e.name,
        employmentType: e.employmentType,
        entity: e.entity ?? "",
        regularRate: e.regularRate,
        dayHours: [0, 0, 0, 0, 0, 0, 0],
        regularHours: 0,
        otHours: 0,
        gross: 0,
      };
      rows.set(key, row);
    }
    row.dayHours[di] = round2(row.dayHours[di] + e.regularHours + e.otHours);
    row.regularHours = round2(row.regularHours + e.regularHours);
    row.otHours = round2(row.otHours + e.otHours);
    row.gross = round2(row.gross + e.totalCost);
  }

  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.regularRate - b.regularRate,
  );
}

export function payrollRowsToCsv(rows: PayrollRow[], weekStart: string): string {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const records = rows.map((r) => ({
    worker: r.name,
    type: r.employmentType,
    entity: r.entity,
    ...Object.fromEntries(
      days.map((d, i) => [d, r.dayHours[i] ? String(r.dayHours[i]) : ""]),
    ),
    regularHours: String(r.regularHours),
    otHours: String(r.otHours),
    rate: r.regularRate.toFixed(2),
    gross: r.gross.toFixed(2),
  }));
  return toCsv(records, [
    { key: "worker", header: "Worker" },
    { key: "type", header: "Type" },
    { key: "entity", header: "Company/Entity" },
    ...days.map((d) => ({ key: d, header: d })),
    { key: "regularHours", header: "Regular Hrs" },
    { key: "otHours", header: "OT Hrs" },
    { key: "rate", header: "Rate" },
    { key: "gross", header: "Gross" },
  ]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
