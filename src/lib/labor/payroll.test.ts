import { describe, expect, it } from "vitest";
import {
  buildPayrollRows,
  payrollRowsToCsv,
  type PayrollEntry,
} from "./payroll";

const WEEK = "2026-06-29"; // Monday

function entry(overrides: Partial<PayrollEntry>): PayrollEntry {
  return {
    personnelId: "p1",
    name: "Doe, Jane",
    employmentType: "W2",
    payType: "HOURLY",
    entity: null,
    workDate: WEEK,
    regularHours: 8,
    otHours: 0,
    regularRate: 30,
    otRate: 45,
    totalCost: 240,
    ...overrides,
  };
}

describe("buildPayrollRows", () => {
  it("buckets hours Mon–Sun and totals gross", () => {
    const rows = buildPayrollRows(
      [
        entry({ workDate: "2026-06-29" }),
        entry({ workDate: "2026-06-30" }),
        entry({ workDate: "2026-07-03", regularHours: 6, otHours: 2, totalCost: 270 }),
      ],
      WEEK,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.dayHours).toEqual([8, 8, 0, 0, 8, 0, 0]);
    expect(r.regularHours).toBe(22);
    expect(r.otHours).toBe(2);
    expect(r.gross).toBe(750);
  });

  it("splits rows on a mid-week rate change", () => {
    const rows = buildPayrollRows(
      [
        entry({ workDate: "2026-06-29", regularRate: 30 }),
        entry({ workDate: "2026-06-30", regularRate: 32, totalCost: 256 }),
      ],
      WEEK,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].regularRate).toBe(30);
    expect(rows[1].regularRate).toBe(32);
  });

  it("ignores entries outside the week and sorts by name", () => {
    const rows = buildPayrollRows(
      [
        entry({ personnelId: "p2", name: "Adams, Zed", workDate: "2026-06-30" }),
        entry({ workDate: "2026-07-06" }), // next Monday — out of range
        entry({ workDate: "2026-06-28" }), // Sunday before — out of range
        entry({}),
      ],
      WEEK,
    );
    expect(rows.map((r) => r.name)).toEqual(["Adams, Zed", "Doe, Jane"]);
  });

  it("merges split shifts on the same day into one bucket", () => {
    const rows = buildPayrollRows(
      [
        entry({ regularHours: 4, totalCost: 120 }),
        entry({ regularHours: 3.5, totalCost: 105 }),
      ],
      WEEK,
    );
    expect(rows[0].dayHours[0]).toBe(7.5);
    expect(rows[0].gross).toBe(225);
  });
});

describe("payrollRowsToCsv", () => {
  it("emits day-of-week columns and escapes commas in names", () => {
    const csv = payrollRowsToCsv(
      buildPayrollRows(
        [entry({ name: 'Smith, John "JJ"', entity: "ABC Drywall, LLC" })],
        WEEK,
      ),
      WEEK,
    );
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toContain("2026-06-29");
    expect(header).toContain("2026-07-05");
    expect(header.endsWith("Regular Hrs,OT Hrs,Rate,Gross")).toBe(true);
    expect(row).toContain('"Smith, John ""JJ"""');
    expect(row).toContain('"ABC Drywall, LLC"');
    expect(header).toContain("Pay Type");
  });

  it("labels non-hourly workers so gross is not read as their pay", () => {
    const csv = payrollRowsToCsv(
      buildPayrollRows([entry({ payType: "PIECEWORK" })], WEEK),
      WEEK,
    );
    const [, row] = csv.trim().split("\r\n");
    expect(row).toContain("Piecework");
    expect(row.endsWith("8,0,30.00,240.00")).toBe(true);
  });
});
