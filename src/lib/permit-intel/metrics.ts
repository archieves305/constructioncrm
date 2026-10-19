import { dayKey } from "@/lib/time/zone";

/**
 * Permit Center's metrics strip, without the database. Pure and client-safe.
 * Each tile carries the permits it counts, so a click shows exactly those —
 * the count is always the length of the list it opens.
 */
export type MetricPermit = {
  id: string;
  status: string;
  approvedDate: Date | null;
  expirationDate: Date | null;
  reviewDaysTarget: number | null;
  cycles: { number: number; submittedAt: Date | null; outcome: string }[];
  /** Items of confirmed notices that are not closed, with their due dates. */
  openItems: { status: string; dueAt: Date | null }[];
  /** The latest confirmed notice's response due date, while corrections are open. */
  responseDueAt: Date | null;
};

export type Tile = { key: string; label: string; value: string; ids: string[]; hint?: string };

/** A permit with no review target is "slow" after this many days. */
export const DEFAULT_REVIEW_DAYS = 30;
const DAY = 86_400_000;
const CLOSED = new Set(["FINAL", "EXPIRED", "DENIED"]);

export function permitMetrics(permits: readonly MetricPermit[], now: Date): Tile[] {
  const active = permits.filter((p) => !CLOSED.has(p.status));
  const latest = (p: MetricPermit) => [...p.cycles].sort((a, b) => b.number - a.number)[0] ?? null;
  const inReview = active.filter((p) => p.status === "APPLIED" && latest(p)?.outcome === "PENDING");
  const month = dayKey(now).slice(0, 7);
  const approvedThisMonth = permits.filter((p) => p.approvedDate && dayKey(p.approvedDate).slice(0, 7) === month);
  const yearAgo = now.getTime() - 365 * DAY;

  // days from the first submission to the approval, issued in the last 12 months
  const durations = permits
    .filter((p) => p.approvedDate && p.approvedDate.getTime() >= yearAgo)
    .map((p) => {
      const first = [...p.cycles].sort((a, b) => a.number - b.number).find((c) => c.submittedAt)?.submittedAt;
      return first ? (p.approvedDate!.getTime() - first.getTime()) / DAY : null;
    })
    .filter((d): d is number => d != null && d >= 0);
  const firstDecided = permits.filter((p) => p.cycles.some((c) => c.number === 1 && c.outcome !== "PENDING" && c.outcome !== "WITHDRAWN"));
  const firstApproved = firstDecided.filter((p) => p.cycles.find((c) => c.number === 1)?.outcome === "APPROVED");
  const issued = permits.filter((p) => p.approvedDate);
  const cyclesPerIssued = issued.map((p) => p.cycles.filter((c) => c.submittedAt || c.outcome !== "PENDING").length || 1);

  const atRisk = active.filter((p) => {
    const l = latest(p);
    const target = (p.reviewDaysTarget ?? DEFAULT_REVIEW_DAYS) * DAY;
    const slow = p.status === "APPLIED" && l?.outcome === "PENDING" && l.submittedAt && now.getTime() - l.submittedAt.getTime() > target;
    const resubmitLate = p.status === "CORRECTIONS" && p.responseDueAt && p.responseDueAt.getTime() < now.getTime();
    const expiring = p.expirationDate && p.expirationDate.getTime() - now.getTime() < 30 * DAY;
    const itemLate = p.openItems.some((i) => i.dueAt && i.dueAt.getTime() < now.getTime());
    return slow || resubmitLate || expiring || itemLate;
  });

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const days = avg(durations);
  const cyc = avg(cyclesPerIssued);
  const ids = (xs: readonly MetricPermit[]) => xs.map((p) => p.id);
  return [
    { key: "active", label: "Active", value: String(active.length), ids: ids(active) },
    { key: "preparing", label: "Preparing", value: String(active.filter((p) => p.status === "PREPARING").length), ids: ids(active.filter((p) => p.status === "PREPARING")) },
    { key: "in-review", label: "In review", value: String(inReview.length), ids: ids(inReview) },
    { key: "corrections", label: "Corrections", value: String(active.filter((p) => p.status === "CORRECTIONS").length), ids: ids(active.filter((p) => p.status === "CORRECTIONS")) },
    { key: "waiting", label: "Waiting on others", value: String(active.filter((p) => p.openItems.some((i) => i.status === "WAITING_THIRD_PARTY")).length), ids: ids(active.filter((p) => p.openItems.some((i) => i.status === "WAITING_THIRD_PARTY"))), hint: "A correction waits on an architect, engineer, owner or supplier" },
    { key: "approved-month", label: "Approved this month", value: String(approvedThisMonth.length), ids: ids(approvedThisMonth) },
    { key: "days-to-approval", label: "Days to approval", value: days == null ? "—" : String(Math.round(days)), ids: ids(permits.filter((p) => p.approvedDate && p.approvedDate.getTime() >= yearAgo)), hint: "Average, first submission to approval, last 12 months" },
    { key: "first-pass", label: "First-submission approval", value: firstDecided.length ? `${Math.round((firstApproved.length / firstDecided.length) * 100)}%` : "—", ids: ids(firstDecided), hint: `${firstApproved.length} of ${firstDecided.length} decided first submissions` },
    { key: "cycles", label: "Review cycles per permit", value: cyc == null ? "—" : cyc.toFixed(1), ids: ids(issued), hint: "Average over issued permits" },
    { key: "at-risk", label: "At risk", value: String(atRisk.length), ids: ids(atRisk), hint: "In review past the target, a resubmission overdue, expiring within 30 days, or a correction past due" },
  ];
}
