import { dayGap } from "./reconcile";

/**
 * Crew labor reaches a job's cost two ways: a payment recorded on the crew's
 * labor contract, and — when the same money leaves the bank — a cc-allocator
 * posting. The cost summary counts the whole labor contract from the day it
 * is signed, so a crew payment that also arrives as an expense is counted
 * twice (2188 Windtrace, 2026-10-14: three BNW bank postings, $58,806.34).
 *
 * Pure matching over flat rows, shared by the intake hold, the labor-payment
 * warning and Cost Reconciliation so all three agree on what a twin is.
 *
 * A twin is an expense on the same job within ±3 days of a labor payment
 * whose amount is close (a transfer fee apart) or whose payee names the
 * crew. Bank memos carry the payee ("ACH TRANSFER TO BNW CONSTRUCTION, LLC"),
 * and one transfer can pay two jobs, so a payee match counts even when the
 * amounts differ — the person sees the difference and decides.
 */

export const LABOR_TWIN_WINDOW_DAYS = 3;

/** Words that say nothing about who a crew is. */
const GENERIC = new Set([
  "and", "builders", "co", "company", "construction", "constructions", "contracting", "contractor",
  "contractors", "corp", "crew", "group", "inc", "llc", "ltd", "of", "pllc", "service", "services",
  "team", "the",
]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** The distinctive words of a crew or contractor name: "BNW Construction" → ["bnw"]. */
export function nameTokens(name: string | null | undefined): string[] {
  return words(name ?? "").filter((w) => w.length >= 3 && !GENERIC.has(w));
}

/** True when the payee text names one of `names` (every distinctive word present). */
export function payeeNames(text: string, names: readonly (string | null | undefined)[]): boolean {
  const have = new Set(words(text));
  return names.some((n) => {
    const t = nameTokens(n);
    return t.length > 0 && t.every((w) => have.has(w));
  });
}

/** Within a transfer fee: $50, or 1% of the larger amount. */
export function amountsClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(50, 0.01 * Math.max(Math.abs(a), Math.abs(b))) + 0.005;
}

export type LaborExpenseRow = {
  id: string;
  jobId: string;
  amount: number;
  incurredDate: Date;
  vendor: string | null;
  description: string | null;
  vendorId: string | null;
  payrollPaymentId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  coveredByLaborPaymentId: string | null;
  laborClearedAt: Date | null;
};

export type LaborContractRow = {
  id: string;
  jobId: string;
  /** Crew name, typed label, vendor name — whatever names the contractor. */
  names: string[];
  vendorId: string | null;
};

export type LaborPaymentRow = {
  id: string;
  laborContractId: string;
  amount: number;
  paidDate: Date;
};

export type LaborTwin = {
  payment: LaborPaymentRow;
  contract: LaborContractRow;
  gapDays: number;
  /** expense − payment: positive when the bank sent more than the crew was credited. */
  difference: number;
  reason: "amount" | "payee";
};

/** An expense still worth checking: positive, counted or waiting, not payroll, not already decided. */
export function isLaborCandidate(e: Pick<LaborExpenseRow, "amount" | "status" | "payrollPaymentId" | "coveredByLaborPaymentId" | "laborClearedAt">): boolean {
  return e.amount > 0 && e.status !== "REJECTED" && !e.payrollPaymentId && !e.coveredByLaborPaymentId && !e.laborClearedAt;
}

function payeeText(e: Pick<LaborExpenseRow, "vendor" | "description">): string {
  return `${e.vendor ?? ""} ${e.description ?? ""}`;
}

function namesContract(e: Pick<LaborExpenseRow, "vendor" | "description" | "vendorId">, c: LaborContractRow): boolean {
  return Boolean(e.vendorId && c.vendorId && e.vendorId === c.vendorId) || payeeNames(payeeText(e), c.names);
}

/**
 * The labor payments this expense may duplicate, best first: exact amount,
 * then nearest day, then smallest difference. `payments` may span jobs.
 */
export function laborTwinsFor(
  e: Pick<LaborExpenseRow, "jobId" | "amount" | "incurredDate" | "vendor" | "description" | "vendorId">,
  payments: readonly LaborPaymentRow[],
  contracts: readonly LaborContractRow[],
  windowDays = LABOR_TWIN_WINDOW_DAYS,
): LaborTwin[] {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const out: LaborTwin[] = [];
  for (const p of payments) {
    const c = byId.get(p.laborContractId);
    if (!c || c.jobId !== e.jobId) continue;
    const gapDays = dayGap(p.paidDate, e.incurredDate);
    if (gapDays > windowDays) continue;
    const reason = amountsClose(e.amount, p.amount) ? "amount" : namesContract(e, c) ? "payee" : null;
    if (!reason) continue;
    out.push({ payment: p, contract: c, gapDays, difference: Math.round((e.amount - p.amount) * 100) / 100, reason });
  }
  return out.sort(
    (a, b) => Number(Math.abs(a.difference) < 0.005 ? 0 : 1) - Number(Math.abs(b.difference) < 0.005 ? 0 : 1) || a.gapDays - b.gapDays || Math.abs(a.difference) - Math.abs(b.difference),
  );
}

/** A labor contract on the expense's job whose contractor the payee names, else null. */
export function crewContractFor(
  e: Pick<LaborExpenseRow, "jobId" | "vendor" | "description" | "vendorId">,
  contracts: readonly LaborContractRow[],
): LaborContractRow | null {
  return contracts.find((c) => c.jobId === e.jobId && namesContract(e, c)) ?? null;
}

export type LaborReview = {
  /** Expenses that look like the same money as a recorded crew payment. */
  twins: { expense: LaborExpenseRow; twin: LaborTwin }[];
  /** Expenses paid to a crew with a labor contract on the job, with no payment recorded to match. */
  crewPaidAsExpense: { expense: LaborExpenseRow; contract: LaborContractRow }[];
};

/**
 * Everything Cost Reconciliation lists under crew payments. A payment that
 * already covers an expense is not offered again.
 */
export function reviewLaborExpenses(
  expenses: readonly LaborExpenseRow[],
  payments: readonly LaborPaymentRow[],
  contracts: readonly LaborContractRow[],
  coveringPaymentIds: ReadonlySet<string> = new Set(),
): LaborReview {
  const open = payments.filter((p) => !coveringPaymentIds.has(p.id));
  const twins: LaborReview["twins"] = [];
  const crewPaidAsExpense: LaborReview["crewPaidAsExpense"] = [];
  for (const e of expenses) {
    if (!isLaborCandidate(e)) continue;
    const best = laborTwinsFor(e, open, contracts)[0];
    if (best) {
      twins.push({ expense: e, twin: best });
      continue;
    }
    const contract = crewContractFor(e, contracts);
    if (contract) crewPaidAsExpense.push({ expense: e, contract });
  }
  const byDate = (a: { expense: LaborExpenseRow }, b: { expense: LaborExpenseRow }) => b.expense.incurredDate.getTime() - a.expense.incurredDate.getTime();
  return { twins: twins.sort(byDate), crewPaidAsExpense: crewPaidAsExpense.sort(byDate) };
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function contractName(c: Pick<LaborContractRow, "names">): string {
  return c.names.find(Boolean) ?? "the crew";
}

/** Note on a bank posting held because it may duplicate a crew payment. */
export function laborTwinHoldNote(t: LaborTwin): string {
  const when = t.payment.paidDate.toISOString().slice(0, 10);
  return `Possible duplicate of the ${when} payment of ${money(t.payment.amount)} to ${contractName(t.contract)} on its labor contract. If it is the same money, choose "Same money" under Admin → Cost Reconciliation → Crew payments; approve only if both are real.`;
}

/** Note on a bank posting held because it pays a crew that has a labor contract on the job. */
export function crewPayeeHoldNote(c: LaborContractRow): string {
  return `Paid to ${contractName(c)}, who has a labor contract on this job. Record it as a payment on that contract under Admin → Cost Reconciliation → Crew payments, so it is counted once; approve it here only if it is not for their contract work.`;
}

/** Review note on an expense counted through a labor payment instead. */
export function coveredNote(payment: Pick<LaborPaymentRow, "amount" | "paidDate">, contract: Pick<LaborContractRow, "names">, expenseAmount: number): string {
  const when = payment.paidDate.toISOString().slice(0, 10);
  const diff = Math.round((expenseAmount - payment.amount) * 100) / 100;
  const rest = Math.abs(diff) < 0.005 ? "" : diff > 0 ? ` The bank sent ${money(diff)} more; file that part where it belongs.` : ` The bank sent ${money(-diff)} less than the payment records.`;
  return `Same money as the ${when} payment of ${money(payment.amount)} to ${contractName(contract)} on its labor contract — counted there, not here.${rest}`;
}
