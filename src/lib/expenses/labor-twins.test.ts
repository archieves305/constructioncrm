import { describe, expect, it } from "vitest";
import {
  amountsClose,
  coveredNote,
  crewContractFor,
  laborTwinsFor,
  nameTokens,
  payeeNames,
  reviewLaborExpenses,
  type LaborContractRow,
  type LaborExpenseRow,
  type LaborPaymentRow,
} from "./labor-twins";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const bnw: LaborContractRow = { id: "lc1", jobId: "j10", names: ["BNW Construction"], vendorId: null };
const team: LaborContractRow = { id: "lc2", jobId: "j2", names: ["Jesus Team"], vendorId: null };
const pay = (id: string, amount: number, date: string, laborContractId = "lc1"): LaborPaymentRow => ({ id, laborContractId, amount, paidDate: d(date) });
const exp = (id: string, amount: number, date: string, vendor: string, extra: Partial<LaborExpenseRow> = {}): LaborExpenseRow => ({
  id, jobId: "j10", amount, incurredDate: d(date), vendor, description: null, vendorId: null, payrollPaymentId: null,
  status: "APPROVED", coveredByLaborPaymentId: null, laborClearedAt: null, ...extra,
});

// The 2188 Windtrace rows, 2026-10-14.
const payments = [
  pay("p1", 41189.4, "2026-05-22"), pay("p2", 11669.15, "2026-07-02"), pay("p3", 10524.74, "2026-07-22"),
  pay("p4", 11694.15, "2026-08-17"), pay("p5", 33913.04, "2026-08-24"), pay("p6", 33913.04, "2026-09-16"),
];
const ach = exp("e2", 13199.15, "2026-08-17", "ACH TRANSFER TO BNW CONSTRUCTION, LLC REQUESTED O N 8/17/2026 FOR WINDTRACE");
const sale = exp("e1", 11694.15, "2026-07-02", "BNW CONSTRUCTION DES:SALE ID: INDN:KNU CONSTRUCTION LLC CO WEB");
const wire = exp("e3", 33913.04, "2026-09-16", "WIRE TYPE:WIRE OUT ET SERVICE CONSTRUCTION, LLC BNF BK:N AVY FEDERAL CREDIT UNI PMT D8B N WINDTRACE", {
  description: "WIRE TYPE:WIRE OUT DATE:260916 TIME:1157 ET TRN:2026091600407448 SERVICE REF:011190 BNF:1/BNW CONSTRUCTION, LLC ID:7159734578",
});

describe("names", () => {
  it("keeps only the distinctive words", () => {
    expect(nameTokens("BNW Construction")).toEqual(["bnw"]);
    expect(nameTokens("Jesus Team")).toEqual(["jesus"]);
    expect(nameTokens("Construction LLC")).toEqual([]);
  });
  it("finds a crew in a bank memo, never through generic words alone", () => {
    expect(payeeNames("ACH TRANSFER TO BNW CONSTRUCTION, LLC", ["BNW Construction"])).toBe(true);
    expect(payeeNames("THE HOME DEPOT LAKELAND FL", ["Elwin Team"])).toBe(false);
    expect(payeeNames("ACME CONSTRUCTION LLC", ["Construction LLC"])).toBe(false);
    expect(payeeNames("BNWX SUPPLY", ["BNW Construction"])).toBe(false);
  });
  it("treats a transfer fee as the same amount, a real difference as not", () => {
    expect(amountsClose(11694.15, 11669.15)).toBe(true);
    expect(amountsClose(4888.23, 4957.5)).toBe(false);
    expect(amountsClose(13199.15, 11694.15)).toBe(false);
  });
});

describe("laborTwinsFor", () => {
  it("matches each Windtrace bank row to its labor payment", () => {
    expect(laborTwinsFor(sale, payments, [bnw])[0]).toMatchObject({ payment: { id: "p2" }, difference: 25, reason: "amount" });
    expect(laborTwinsFor(ach, payments, [bnw])[0]).toMatchObject({ payment: { id: "p4" }, difference: 1505, reason: "payee" });
    expect(laborTwinsFor(wire, payments, [bnw])[0]).toMatchObject({ payment: { id: "p6" }, difference: 0, gapDays: 0 });
  });
  it("prefers the exact amount over a nearer day", () => {
    const ps = [pay("a", 1000, "2026-01-02"), pay("b", 1010, "2026-01-01")];
    expect(laborTwinsFor(exp("x", 1000, "2026-01-01", "Someone"), ps, [bnw])[0].payment.id).toBe("a");
  });
  it("ignores other jobs, other payees and dates past the window", () => {
    expect(laborTwinsFor(exp("x", 3400, "2026-07-01", "Rocket HVACR Inc.", { jobId: "j2" }), [pay("q", 3000, "2026-07-03", "lc2")], [team])).toEqual([]);
    expect(laborTwinsFor({ ...wire, jobId: "j11" }, payments, [bnw])).toEqual([]);
    expect(laborTwinsFor({ ...wire, incurredDate: d("2026-09-20") }, payments, [bnw])).toEqual([]);
  });
});

describe("reviewLaborExpenses", () => {
  it("lists twins, skips decided rows and payments already covering a row", () => {
    const r = reviewLaborExpenses(
      [sale, ach, wire, exp("e4", 500, "2026-09-16", "x", { coveredByLaborPaymentId: "p6" }), exp("e5", 33913.04, "2026-08-24", "y", { laborClearedAt: d("2026-10-01") })],
      payments,
      [bnw],
      new Set(["p6"]),
    );
    expect(r.twins.map((t) => [t.expense.id, t.twin.payment.id])).toEqual([["e2", "p4"], ["e1", "p2"]]);
    // The wire's payment already covers another row; the payee still names the crew.
    expect(r.crewPaidAsExpense.map((c) => c.expense.id)).toEqual(["e3"]);
  });
  it("flags a crew paid only as an expense", () => {
    const c11: LaborContractRow = { ...bnw, id: "lc11", jobId: "j11" };
    const e = exp("e6", 25760.74, "2026-06-02", "BNW CONSTRUCTION DES:SALE", { jobId: "j11" });
    expect(crewContractFor(e, [c11])?.id).toBe("lc11");
    expect(reviewLaborExpenses([e], [], [c11]).crewPaidAsExpense).toHaveLength(1);
  });
  it("never offers payroll, credits, rejected rows", () => {
    const rows = [exp("a", 100, "2026-09-16", "BNW", { payrollPaymentId: "pp" }), exp("b", -100, "2026-09-16", "BNW"), exp("c", 33913.04, "2026-09-16", "BNW", { status: "REJECTED" })];
    expect(reviewLaborExpenses(rows, payments, [bnw])).toEqual({ twins: [], crewPaidAsExpense: [] });
  });
});

describe("coveredNote", () => {
  it("names the payment and the remainder", () => {
    expect(coveredNote(payments[3], bnw, 13199.15)).toContain("The bank sent $1,505.00 more");
    expect(coveredNote(payments[5], bnw, 33913.04)).not.toContain("The bank sent");
  });
});
