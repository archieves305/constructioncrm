/**
 * What a crew is due for the lines of its labor contract that are finished.
 * Pure and client-safe: the schedule dialog shows it and the payment request
 * uses the same figure.
 */
export type ScheduleLine = {
  id: string;
  name: string;
  status: string;
  inspectionRequired: boolean;
  inspectionStatus: string;
  paymentAmount: number | null;
  /** The payment request that already covers this line, if any. */
  paymentRequestId?: string | null;
};

/** A line is approved for payment once it is complete and, where an inspection is required, has passed. */
export function isApprovedForPayment(l: Pick<ScheduleLine, "status" | "inspectionRequired" | "inspectionStatus">): boolean {
  return l.status === "COMPLETE" && (!l.inspectionRequired || l.inspectionStatus === "PASSED");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type NetDue = { lineIds: string[]; gross: number; retainage: number; deductions: number; net: number };

/**
 * Net due on a set of lines: gross less retainage held, less backcharges and
 * payments already made directly. Never negative.
 */
export function netDueForLines(
  lines: ScheduleLine[],
  retainagePercent: number,
  deductions: { backcharges?: number; directPayments?: number } = {},
): NetDue {
  const gross = round2(lines.reduce((s, l) => s + (l.paymentAmount ?? 0), 0));
  const retainage = round2((gross * (retainagePercent || 0)) / 100);
  const taken = round2((deductions.backcharges || 0) + (deductions.directPayments || 0));
  return { lineIds: lines.map((l) => l.id), gross, retainage, deductions: taken, net: Math.max(0, round2(gross - retainage - taken)) };
}

/** Approved lines with an amount that no request covers yet — what "Request this payment" would ask for. */
export function requestableLines(lines: ScheduleLine[]): ScheduleLine[] {
  return lines.filter((l) => isApprovedForPayment(l) && (l.paymentAmount ?? 0) > 0 && !l.paymentRequestId);
}
