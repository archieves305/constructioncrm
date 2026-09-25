import type { ExpenseStatus } from "@/generated/prisma/client";

/**
 * Matching a cc-allocator posting against the manual charges already on a
 * job — the check-and-balance between "money that moved" (cc-allocator)
 * and "job costing" (the CRM). Pure functions over a flat projection so
 * the intake route, the admin page and the one-off backout script all
 * agree on what a "twin" is.
 *
 * A twin is a manual, APPROVED, non-payroll row on the same job for the
 * same amount, incurred within ±TWIN_WINDOW_DAYS. Same day is the strong
 * signal; a few days' gap covers a check written on Friday and cleared on
 * Tuesday. Vendor strings are shown, never compared: "Home Depot" and
 * "THE HOME DEPOT HOLLYWOOD FL" are the same charge, and two payees with
 * the same name on the same day are not.
 */

export const TWIN_WINDOW_DAYS = 3;

export type ReconcileRow = {
  id: string;
  jobId: string;
  amount: number;
  incurredDate: Date;
  vendor: string | null;
  externalId: string | null;
  payrollPaymentId: string | null;
  status: ExpenseStatus;
  createdAt: Date;
  createdByUserId: string;
};

export type TwinSource = "card" | "bank";

export type TwinPair = {
  key: string;
  manual: ReconcileRow;
  external: ReconcileRow;
  gapDays: number;
  exact: boolean;
  source: TwinSource;
};

const DAY = 86_400_000;

function utcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY);
}

/** Whole calendar days between two dates, ignoring time of day. */
export function dayGap(a: Date, b: Date): number {
  return Math.abs(utcDay(a) - utcDay(b));
}

function sameCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export function isManualCandidate(r: Pick<ReconcileRow, "status" | "externalId" | "payrollPaymentId">): boolean {
  return r.status === "APPROVED" && !r.externalId && !r.payrollPaymentId;
}

export function sourceOf(externalId: string): TwinSource {
  return externalId.startsWith("bank:") ? "bank" : "card";
}

export function pairKey(manualId: string, externalId: string): string {
  return `${manualId}:${externalId}`;
}

/**
 * The manual row an incoming posting most likely duplicates, or null.
 * Nearest day first, then the row entered earliest.
 */
export function findManualTwin(
  incoming: { jobId: string; amount: number; incurredDate: Date },
  rows: ReconcileRow[],
  windowDays = TWIN_WINDOW_DAYS,
): ReconcileRow | null {
  let best: { row: ReconcileRow; gap: number } | null = null;
  for (const r of rows) {
    if (r.jobId !== incoming.jobId || !isManualCandidate(r) || !sameCents(r.amount, incoming.amount)) continue;
    const gap = dayGap(r.incurredDate, incoming.incurredDate);
    if (gap > windowDays) continue;
    if (!best || gap < best.gap || (gap === best.gap && r.createdAt < best.row.createdAt)) best = { row: r, gap };
  }
  return best?.row ?? null;
}

/** The review note written on a posting that is held as a possible duplicate. */
export function twinReviewNote(twin: ReconcileRow): string {
  const when = twin.incurredDate.toISOString().slice(0, 10);
  return `Possible duplicate of manual charge ${twin.id} (${twin.vendor ?? "no vendor"}, ${when}, $${twin.amount.toFixed(2)}). Approve if both are real; otherwise delete the manual row from Cost Reconciliation.`;
}

/**
 * Every manual↔allocator pair still undecided. `decided` holds pairKeys a
 * person has already ruled on (DUPLICATE or KEEP). Exact-day pairs first,
 * then by gap, then largest amount.
 */
export function pairCandidates(rows: ReconcileRow[], decided: ReadonlySet<string> = new Set(), windowDays = TWIN_WINDOW_DAYS): TwinPair[] {
  const manualByJob = new Map<string, ReconcileRow[]>();
  for (const r of rows) {
    if (!isManualCandidate(r)) continue;
    manualByJob.set(r.jobId, [...(manualByJob.get(r.jobId) ?? []), r]);
  }
  const out: TwinPair[] = [];
  for (const x of rows) {
    if (!x.externalId || x.status !== "APPROVED") continue;
    for (const m of manualByJob.get(x.jobId) ?? []) {
      if (!sameCents(m.amount, x.amount)) continue;
      const gap = dayGap(m.incurredDate, x.incurredDate);
      if (gap > windowDays) continue;
      const key = pairKey(m.id, x.id);
      if (decided.has(key)) continue;
      out.push({ key, manual: m, external: x, gapDays: gap, exact: gap === 0, source: sourceOf(x.externalId) });
    }
  }
  return out.sort(
    (a, b) => Number(b.exact) - Number(a.exact) || a.gapDays - b.gapDays || b.manual.amount - a.manual.amount || a.manual.jobId.localeCompare(b.manual.jobId),
  );
}
