import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recomputeJobBalance } from "@/lib/services/job-pricing";
import { syncInvoiceStatus } from "@/lib/services/invoices";

const METHODS = [
  "CHECK",
  "CARD",
  "ACH",
  "CASH",
  "FINANCING",
  "WIRE",
  "OTHER",
] as const;

const updateSchema = z.object({
  amount: z.number().positive().optional(),
  paymentType: z.enum(["DEPOSIT", "PROGRESS", "FINAL", "FINANCING_FUNDING"]).optional(),
  method: z.enum(METHODS).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  receivedDate: z.string().nullable().optional(),
  // Re-apply (or clear) which invoice this payment pays. Pass null to detach.
  invoiceId: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const v = await validateBody(request, updateSchema);
  if (!v.ok) return v.response;
  const d = v.data;

  const existing = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, jobId: true, invoiceId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Validate any newly-applied invoice belongs to the same job.
  if (d.invoiceId) {
    const inv = await prisma.invoice.findUnique({
      where: { id: d.invoiceId },
      select: { jobId: true },
    });
    if (!inv || inv.jobId !== existing.jobId)
      return badRequest("Invoice does not belong to this job");
  }

  const data: Record<string, unknown> = {};
  if (d.amount !== undefined) data.amount = d.amount;
  if (d.paymentType !== undefined) data.paymentType = d.paymentType;
  if (d.method !== undefined) data.method = d.method ?? null;
  if (d.reference !== undefined) data.reference = d.reference?.trim() || null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
  if (d.receivedDate !== undefined)
    data.receivedDate = d.receivedDate ? new Date(d.receivedDate) : null;
  if (d.invoiceId !== undefined) data.invoiceId = d.invoiceId || null;

  await prisma.payment.update({ where: { id }, data });

  await recomputeJobBalance(existing.jobId);
  // Reconcile both the previously-linked and newly-linked invoices.
  const touched = new Set<string>();
  if (existing.invoiceId) touched.add(existing.invoiceId);
  if (d.invoiceId !== undefined && d.invoiceId) touched.add(d.invoiceId);
  for (const invId of touched) await syncInvoiceStatus(invId);

  const record = await prisma.payment.findUnique({ where: { id } });
  return NextResponse.json(record);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, jobId: true, invoiceId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.payment.delete({ where: { id } });

  await recomputeJobBalance(existing.jobId);
  if (existing.invoiceId) await syncInvoiceStatus(existing.invoiceId);

  return NextResponse.json({ ok: true });
}
