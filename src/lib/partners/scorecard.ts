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
