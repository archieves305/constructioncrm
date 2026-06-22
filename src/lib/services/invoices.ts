import { prisma } from "@/lib/db/prisma";

/**
 * Next invoice number for a job, e.g. "INV-1234-03". Derived from the highest
 * existing suffix on the job's invoices rather than the invoice count, so that
 * deleting an invoice (e.g. reversing an approved change order) never leaves a
 * gap that makes a later create collide with a surviving number.
 */
export async function nextInvoiceNumber(
  jobNumber: string,
  jobId: string,
  tx = prisma,
): Promise<string> {
  const prefix = jobNumber.replace("JOB-", "INV-");
  const existing = await tx.invoice.findMany({
    where: { jobId },
    select: { invoiceNumber: true },
  });
  let max = 0;
  for (const { invoiceNumber } of existing) {
    const m = invoiceNumber.match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

/**
 * Reconcile an invoice's status with the payments applied to it. Payments drive
 * status: an invoice flips to PAID once received payments cover its amount, and
 * reverts to SENT if a later edit/delete drops coverage below the amount. VOID
 * and DRAFT invoices are left alone (they aren't payment-driven).
 */
export async function syncInvoiceStatus(invoiceId: string, tx = prisma) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, amount: true, status: true },
  });
  if (!invoice) return;
  if (invoice.status === "VOID") return;

  const payments = await tx.payment.findMany({
    where: { invoiceId, status: "RECEIVED" },
    select: { amount: true },
  });
  const applied = payments.reduce((s, p) => s + Number(p.amount), 0);
  const covered = applied >= Number(invoice.amount);

  if (covered && invoice.status !== "PAID") {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "PAID", paidAt: new Date() },
    });
  } else if (!covered && invoice.status === "PAID") {
    // Coverage dropped (payment edited/deleted) — revert to SENT.
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "SENT", paidAt: null },
    });
  }
}
