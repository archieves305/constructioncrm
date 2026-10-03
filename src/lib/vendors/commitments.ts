/**
 * Commitments: what has been promised to a vendor on a job and not paid yet.
 *
 * Pure and client-safe. A commitment is a promise, not a cost. Only the part
 * no expense has drawn down counts, as "committed"; as expenses arrive against
 * it the money moves from committed to spent and is never counted twice.
 * Closing a commitment releases whatever is left; cancelling one releases all
 * of it. Only APPROVED expenses draw a commitment down — a pending charge
 * moves no money anywhere.
 */

export type CommitmentStatusName = "OPEN" | "CLOSED" | "CANCELLED";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What is still promised: the amount less what approved expenses have drawn, while the commitment is open. */
export function openAmount(c: { status: CommitmentStatusName; amount: number }, received: number): number {
  if (c.status !== "OPEN") return 0;
  return round2(Math.max(0, c.amount - received));
}

/** Σ of approved expenses linked to a commitment. Credits (negative) give money back to it. */
export function receivedAmount(expenses: readonly { amount: number; status: string }[]): number {
  return round2(expenses.reduce((s, e) => (e.status === "APPROVED" ? s + e.amount : s), 0));
}

/**
 * The commitment a new expense belongs to without anyone picking: the job has
 * exactly one OPEN commitment for the expense's vendor. Two or more is a
 * choice for a person, made on the expense.
 */
export function commitmentForExpense(vendorId: string | null, open: readonly { id: string; vendorId: string }[]): string | null {
  if (!vendorId) return null;
  const mine = open.filter((c) => c.vendorId === vendorId);
  return mine.length === 1 ? mine[0].id : null;
}

export const commitmentCode = (number: number) => `C-${number}`;

export const COMMITMENT_STATUS_LABEL: Record<CommitmentStatusName, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** May the status move this way? Anything may be reopened; a cancelled commitment is not closed. */
export function canMoveStatus(from: CommitmentStatusName, to: CommitmentStatusName): boolean {
  if (from === to) return true;
  if (from === "CANCELLED" && to === "CLOSED") return false;
  return true;
}
