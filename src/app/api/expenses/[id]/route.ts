import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recomputeCostPlusJob } from "@/lib/services/job-pricing";

const TYPES = [
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "PERMIT_FEE",
  "SUBCONTRACTOR",
  "CHANGE_ORDER",
  "OTHER",
] as const;

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
  type: z.enum(TYPES).optional(),
  vendor: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  amount: z.number().min(0).optional(),
  incurredDate: z.string().optional(),
  paidMethod: z.enum(METHODS).nullable().optional(),
  paidFrom: z.string().max(120).nullable().optional(),
  billable: z.boolean().optional(),
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

  const existing = await prisma.jobExpense.findUnique({
    where: { id },
    include: { job: { select: { jobType: true } } },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isCostPlus = existing.job.jobType === "COST_PLUS";
  const prevBillable = existing.billable;
  const prevAmount = Number(existing.amount);
  const nextBillable = isCostPlus
    ? false
    : parsed.data.billable ?? prevBillable;
  const nextAmount =
    parsed.data.amount !== undefined ? parsed.data.amount : prevAmount;

  const prevBillableAmount = prevBillable ? prevAmount : 0;
  const nextBillableAmount = nextBillable ? nextAmount : 0;
  const delta = isCostPlus ? 0 : nextBillableAmount - prevBillableAmount;

  const data: Record<string, unknown> = {};
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.vendor !== undefined)
    data.vendor = parsed.data.vendor?.trim() || null;
  if (parsed.data.description !== undefined)
    data.description = parsed.data.description?.trim() || null;
  if (parsed.data.amount !== undefined) data.amount = parsed.data.amount;
  if (parsed.data.incurredDate !== undefined)
    data.incurredDate = new Date(parsed.data.incurredDate);
  if (parsed.data.paidMethod !== undefined)
    data.paidMethod = parsed.data.paidMethod ?? null;
  if (parsed.data.paidFrom !== undefined)
    data.paidFrom = parsed.data.paidFrom?.trim() || null;
  if (parsed.data.billable !== undefined && !isCostPlus)
    data.billable = parsed.data.billable;

  await prisma.$transaction([
    prisma.jobExpense.update({ where: { id }, data }),
    ...(delta !== 0
      ? [
          prisma.job.update({
            where: { id: existing.jobId },
            data: {
              contractAmount: { increment: delta },
              balanceDue: { increment: delta },
            },
          }),
        ]
      : []),
  ]);

  if (isCostPlus) await recomputeCostPlusJob(existing.jobId);

  const record = await prisma.jobExpense.findUnique({
    where: { id },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
  });
  return NextResponse.json(record);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.jobExpense.findUnique({
    where: { id },
    include: { job: { select: { jobType: true } } },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isCostPlus = existing.job.jobType === "COST_PLUS";
  const reverseAmount = !isCostPlus && existing.billable ? Number(existing.amount) : 0;

  await prisma.$transaction([
    prisma.jobExpense.delete({ where: { id } }),
    ...(reverseAmount > 0
      ? [
          prisma.job.update({
            where: { id: existing.jobId },
            data: {
              contractAmount: { decrement: reverseAmount },
              balanceDue: { decrement: reverseAmount },
            },
          }),
        ]
      : []),
  ]);

  if (isCostPlus) await recomputeCostPlusJob(existing.jobId);

  return NextResponse.json({ ok: true });
}
