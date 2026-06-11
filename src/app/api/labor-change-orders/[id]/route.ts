import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recomputeJobLabor } from "@/lib/services/job-pricing";

const updateSchema = z.object({
  amount: z.number().refine((n) => n !== 0, "Amount cannot be zero").optional(),
  reason: z.string().max(2000).nullable().optional(),
  changeDate: z.string().optional(),
  scopeChange: z.string().max(4000).nullable().optional(),
  addedScope: z.string().max(4000).nullable().optional(),
  removedScope: z.string().max(4000).nullable().optional(),
  timeAdjustmentDays: z.number().int().nullable().optional(),
  updatedPaymentTerms: z.string().max(2000).nullable().optional(),
  paymentImpact: z.string().max(2000).nullable().optional(),
  retainageImpact: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const existing = await prisma.laborChangeOrder.findUnique({
    where: { id },
    include: { laborContract: { select: { jobId: true } } },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.amount !== undefined) data.amount = d.amount;
  if (d.reason !== undefined) data.reason = d.reason?.trim() || null;
  if (d.changeDate !== undefined && d.changeDate)
    data.changeDate = new Date(d.changeDate);
  if (d.scopeChange !== undefined) data.scopeChange = d.scopeChange?.trim() || null;
  if (d.addedScope !== undefined) data.addedScope = d.addedScope?.trim() || null;
  if (d.removedScope !== undefined)
    data.removedScope = d.removedScope?.trim() || null;
  if (d.timeAdjustmentDays !== undefined)
    data.timeAdjustmentDays = d.timeAdjustmentDays;
  if (d.updatedPaymentTerms !== undefined)
    data.updatedPaymentTerms = d.updatedPaymentTerms?.trim() || null;
  if (d.paymentImpact !== undefined)
    data.paymentImpact = d.paymentImpact?.trim() || null;
  if (d.retainageImpact !== undefined)
    data.retainageImpact = d.retainageImpact?.trim() || null;

  const updated = await prisma.laborChangeOrder.update({ where: { id }, data });
  if (d.amount !== undefined)
    await recomputeJobLabor(existing.laborContract.jobId);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.laborChangeOrder.findUnique({
    where: { id },
    include: { laborContract: { select: { jobId: true } } },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.laborChangeOrder.delete({ where: { id } });
  await recomputeJobLabor(existing.laborContract.jobId);

  return NextResponse.json({ ok: true });
}
