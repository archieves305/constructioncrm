import type { BidDecision, BidOutcome, BidStatus } from "@/generated/prisma/enums";

/**
 * Bid KPIs over a window, from the invitation rows. Pure; Stage 4 adds the
 * money side (revenue, profit, days to pay) on top of `getJobCostRows`.
 */
export type BidRowForKpi = {
  status: BidStatus;
  decision: BidDecision;
  outcome: BidOutcome | null;
  invitedAt: Date | string | null;
  decidedAt: Date | string | null;
  submittedAt: Date | string | null;
  outcomeAt: Date | string | null;
  estimatedValue: number | null;
  latestAmount: number | null;
  awardedAmount: number | null;
  lossReason: string | null;
  estimatingHours: number | null;
};

export type Window = { from: Date; to: Date };

const inWindow = (d: Date | string | null, w: Window) => {
  if (!d) return false;
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  return t >= w.from.getTime() && t <= w.to.getTime();
};

export type BidKpis = {
  invitations: number;
  decided: number;
  bid: number;
  noBid: number;
  bidRate: number | null;
  submitted: number;
  awarded: number;
  lost: number;
  winRate: number | null;
  open: number;
  openValue: number;
  awardedValue: number;
  avgTurnaroundDays: number | null;
  estimatingHours: number;
  lossReasons: Record<string, number>;
};

export function bidKpis(rows: readonly BidRowForKpi[], w: Window): BidKpis {
  const invitations = rows.filter((r) => inWindow(r.invitedAt, w)).length;
  const decidedRows = rows.filter((r) => r.decision !== "UNDECIDED" && inWindow(r.decidedAt, w));
  const bid = decidedRows.filter((r) => r.decision === "BID").length;
  const noBid = decidedRows.filter((r) => r.decision === "NO_BID").length;
  const submittedRows = rows.filter((r) => inWindow(r.submittedAt, w));
  const closed = rows.filter((r) => inWindow(r.outcomeAt, w));
  const awarded = closed.filter((r) => r.outcome === "AWARDED").length;
  const lost = closed.filter((r) => r.outcome === "LOST").length;
  const openRows = rows.filter((r) => r.status !== "CLOSED");
  const turnarounds = submittedRows.filter((r) => r.invitedAt && r.submittedAt).map((r) => (new Date(r.submittedAt!).getTime() - new Date(r.invitedAt!).getTime()) / 86_400_000);
  const lossReasons: Record<string, number> = {};
  for (const r of closed) if (r.outcome === "LOST") lossReasons[r.lossReason ?? "UNKNOWN"] = (lossReasons[r.lossReason ?? "UNKNOWN"] ?? 0) + 1;
  return {
    invitations,
    decided: decidedRows.length,
    bid,
    noBid,
    bidRate: decidedRows.length ? bid / decidedRows.length : null,
    submitted: submittedRows.length,
    awarded,
    lost,
    winRate: awarded + lost ? awarded / (awarded + lost) : null,
    open: openRows.length,
    openValue: openRows.reduce((s, r) => s + (r.latestAmount ?? r.estimatedValue ?? 0), 0),
    awardedValue: closed.filter((r) => r.outcome === "AWARDED").reduce((s, r) => s + (r.awardedAmount ?? 0), 0),
    avgTurnaroundDays: turnarounds.length ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : null,
    estimatingHours: decidedRows.filter((r) => r.decision === "BID").reduce((s, r) => s + (r.estimatingHours ?? 0), 0),
    lossReasons,
  };
}

// ── Money (Stage 4) ───────────────────────────────────────────────────────

export type JobMoneyRow = {
  jobId: string;
  billable: boolean;
  revisedContract: number;
  projectedProfit: number | null;
  /** Retainage withheld on progress applications and not yet released. */
  retainageHeld: number;
  createdAt: Date | string;
};
export type InvoiceRow = { jobId: string; amount: number; issueDate: Date | string; status: string };
export type PaymentRow = { amount: number; receivedDate: Date | string | null; invoiceIssueDate: Date | string | null; status: string };
export type ChangeOrderRow = { status: string; decidedAt: Date | string | null };

export type MoneyKpis = {
  /** Σ invoices issued (not draft, not void) in the window. */
  billed: number;
  collected: number;
  /** Over the jobs active in the window (created in it, or billed in it): Σ revised contract and Σ projected profit of the billable ones with a projection. */
  contractValue: number;
  grossProfit: number | null;
  margin: number | null;
  averageContract: number | null;
  /** Mean days invoice → payment over payments received in the window that are linked to an invoice. */
  daysToPay: number | null;
  linkedPayments: number;
  /** Payments received in the window with no invoice link: left out of days-to-pay. */
  unlinkedPayments: number;
  /** Held now on the given jobs (a balance, not windowed). */
  retainageHeld: number;
  changeOrderApprovalRate: number | null;
  changeOrdersDecided: number;
  /** Jobs active in the window. */
  jobs: number;
  /** Two or more jobs with this account, ever. */
  repeatWork: boolean;
};

export function moneyKpis(input: { jobs: readonly JobMoneyRow[]; invoices: readonly InvoiceRow[]; payments: readonly PaymentRow[]; changeOrders: readonly ChangeOrderRow[] }, w: Window): MoneyKpis {
  const billed = input.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID" && inWindow(i.issueDate, w)).reduce((s, i) => s + i.amount, 0);
  const received = input.payments.filter((p) => p.status === "RECEIVED" && inWindow(p.receivedDate, w));
  const linked = received.filter((p) => p.invoiceIssueDate);
  const lags = linked.map((p) => (new Date(p.receivedDate!).getTime() - new Date(p.invoiceIssueDate!).getTime()) / 86_400_000).filter((d) => d >= 0);
  const issued = input.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
  const billedJobs = new Set(issued.filter((i) => inWindow(i.issueDate, w)).map((i) => i.jobId));
  const active = input.jobs.filter((j) => inWindow(j.createdAt, w) || billedJobs.has(j.jobId));
  const billable = active.filter((j) => j.billable);
  const projected = billable.filter((j) => j.projectedProfit !== null);
  const contractOfProjected = projected.reduce((s, j) => s + j.revisedContract, 0);
  const gp = projected.length ? projected.reduce((s, j) => s + (j.projectedProfit ?? 0), 0) : null;
  const decided = input.changeOrders.filter((c) => (c.status === "APPROVED" || c.status === "REJECTED") && inWindow(c.decidedAt, w));
  return {
    billed: round2(billed),
    collected: round2(received.reduce((s, p) => s + p.amount, 0)),
    contractValue: round2(billable.reduce((s, j) => s + j.revisedContract, 0)),
    grossProfit: gp === null ? null : round2(gp),
    margin: gp !== null && contractOfProjected > 0 ? gp / contractOfProjected : null,
    averageContract: billable.length ? round2(billable.reduce((s, j) => s + j.revisedContract, 0) / billable.length) : null,
    daysToPay: lags.length ? Math.round((lags.reduce((a, b) => a + b, 0) / lags.length) * 10) / 10 : null,
    linkedPayments: lags.length,
    unlinkedPayments: received.length - linked.length,
    retainageHeld: round2(input.jobs.reduce((s, j) => s + j.retainageHeld, 0)),
    changeOrderApprovalRate: decided.length ? decided.filter((c) => c.status === "APPROVED").length / decided.length : null,
    changeOrdersDecided: decided.length,
    jobs: active.length,
    repeatWork: input.jobs.length >= 2,
  };
}

/** Gross profit per estimating hour: of the awards in the window (realised) and of every bid we worked (blended). */
export function profitPerHour(grossProfitOfAwards: number | null, hoursOnAwards: number, hoursOnAllBids: number): { perAwardHour: number | null; perBidHour: number | null } {
  return {
    perAwardHour: grossProfitOfAwards !== null && hoursOnAwards > 0 ? round2(grossProfitOfAwards / hoursOnAwards) : null,
    perBidHour: grossProfitOfAwards !== null && hoursOnAllBids > 0 ? round2(grossProfitOfAwards / hoursOnAllBids) : null,
  };
}

/** Rows keyed by a grouping (org, trade, market, owner); a row may sit in several groups (a bid with two trades). */
export function groupBy<T>(rows: readonly T[], keysOf: (r: T) => { key: string; label: string }[]): { key: string; label: string; rows: T[] }[] {
  const m = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const r of rows) for (const k of keysOf(r)) {
    const g = m.get(k.key) ?? { key: k.key, label: k.label, rows: [] };
    g.rows.push(r);
    m.set(k.key, g);
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
