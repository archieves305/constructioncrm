import { amountsClose, LABOR_TWIN_WINDOW_DAYS, payeeNames } from "@/lib/expenses/labor-twins";
import { dayGap } from "@/lib/expenses/reconcile";

/**
 * Crew payments, one posting (Richard, 2026-11-21). A crew payment is recorded
 * in the CRM; the same money then reaches CC Allocator as a bank or Amex line,
 * which CC Allocator posts to QuickBooks once. That line is LINKED to the
 * crew payment here — never added to the job as an expense — so the payment
 * is counted once in the CRM and once in QuickBooks.
 *
 * Pure rules shared by the candidate endpoint CC Allocator calls and the
 * intake that links the line. The CRM never posts to QuickBooks itself.
 */

export type AllocatorLine = {
  amount: number;
  date: Date;
  /** The bank memo or card merchant text. */
  payee: string | null;
  /** CC Allocator's account key for the line (`bank:<id>` / `card:<id>:<companyId>`), when known. */
  accountKey: string | null;
};

export type CrewPaymentRow = {
  id: string;
  jobId: string;
  amount: number;
  paidDate: Date;
  paidFromKey: string | null;
  /** The crew, label and vendor names of its labor contract. */
  names: string[];
  /** Already linked to a CC Allocator line. */
  linked: boolean;
  /** Already counted through a covered expense (the old hand reconciliation). */
  covered: boolean;
};

export type CrewPaymentCandidate = CrewPaymentRow & {
  exactAmount: boolean;
  sameAccount: boolean;
  payeeMatch: boolean;
  days: number;
};

/** Same money within the window: the exact amount, or the crew named in the payee with a close amount. Another account rules it out. */
export function crewPaymentCandidates(line: AllocatorLine, payments: readonly CrewPaymentRow[]): CrewPaymentCandidate[] {
  const out: CrewPaymentCandidate[] = [];
  for (const p of payments) {
    if (p.linked || p.covered) continue;
    const days = dayGap(line.date, p.paidDate);
    if (days > LABOR_TWIN_WINDOW_DAYS) continue;
    if (line.accountKey && p.paidFromKey && line.accountKey !== p.paidFromKey) continue;
    const exactAmount = Math.abs(line.amount - p.amount) < 0.005;
    const payeeMatch = Boolean(line.payee) && payeeNames(line.payee as string, p.names);
    if (!exactAmount && !(payeeMatch && amountsClose(line.amount, p.amount))) continue;
    out.push({ ...p, exactAmount, sameAccount: Boolean(line.accountKey && p.paidFromKey === line.accountKey), payeeMatch, days });
  }
  return out.sort(
    (a, b) =>
      Number(b.exactAmount) - Number(a.exactAmount) ||
      Number(b.sameAccount) - Number(a.sameAccount) ||
      Number(b.payeeMatch) - Number(a.payeeMatch) ||
      a.days - b.days,
  );
}

/** The one candidate CC Allocator may pre-fill: exactly one, or one clearly ahead (exact amount on the same account, the rest not). */
export function soleCandidate(candidates: readonly CrewPaymentCandidate[]): CrewPaymentCandidate | null {
  if (candidates.length === 1) return candidates[0];
  const strong = candidates.filter((c) => c.exactAmount && c.sameAccount);
  return strong.length === 1 ? strong[0] : null;
}

export type OpenRequestRow = { id: string; amount: number; status: string };

/** The open payment request a payment answers, when exactly one on the contract is close in amount. */
export function openRequestFor(amount: number, requests: readonly OpenRequestRow[]): string | null {
  const open = requests.filter((r) => r.status === "REQUESTED" && amountsClose(r.amount, amount));
  if (open.length === 1) return open[0].id;
  const exact = open.filter((r) => Math.abs(r.amount - amount) < 0.005);
  return exact.length === 1 ? exact[0].id : null;
}

export type LinkRefusal = { status: 404 | 409 | 400; error: string };

/** Why a CRM crew payment cannot take this line, or null. */
export function linkProblem(
  payment: { jobId: string; allocatorExternalId: string | null; covered: boolean } | null,
  input: { jobId: string; externalId: string; amount: number },
): LinkRefusal | null {
  if (!payment) return { status: 404, error: "Crew payment not found" };
  if (payment.jobId !== input.jobId) return { status: 409, error: "That crew payment is on a different job" };
  if (payment.allocatorExternalId && payment.allocatorExternalId !== input.externalId)
    return { status: 409, error: "That crew payment is already linked to another bank or card line" };
  if (payment.covered) return { status: 409, error: "That crew payment is already matched to a posting on the job" };
  if (input.amount <= 0) return { status: 400, error: "A crew payment line must be money out" };
  return null;
}

/** What the payment row says about QuickBooks. */
export function quickBooksState(p: { paidFromKey: string | null; allocatorExternalId: string | null; allocatorLineDate: Date | null; allocatorLineAmount: number | null; amount: number }):
  | { kind: "linked"; text: string; differs: boolean }
  | { kind: "waiting"; text: string }
  | { kind: "none" } {
  if (p.allocatorExternalId) {
    const day = p.allocatorLineDate ? p.allocatorLineDate.toISOString().slice(0, 10) : null;
    const differs = p.allocatorLineAmount !== null && Math.abs(p.allocatorLineAmount - p.amount) >= 0.005;
    return { kind: "linked", text: `In QuickBooks${day ? ` · line ${day}` : ""}`, differs };
  }
  if (p.paidFromKey) return { kind: "waiting", text: "Not in QuickBooks yet — waits for the bank or card line in CC Allocator" };
  return { kind: "none" };
}
