import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import {
  canDeleteExpense,
  canEnterJobCosts,
  getCostGrants,
  ALLOCATOR_DELETE_MESSAGE,
  COST_DENIED_MESSAGE,
} from "@/lib/expenses/permissions";
import {
  recomputeCostPlusJob,
  recomputeJobBalance,
  rollsExpensesIntoContract,
} from "@/lib/services/job-pricing";

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

  const grants = await getCostGrants(session.user.id);
  if (!canEnterJobCosts(session.user.role, grants)) {
    return NextResponse.json({ error: COST_DENIED_MESSAGE }, { status: 403 });
  }

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

  const isCostPlus = rollsExpensesIntoContract(existing.job.jobType);
  const prevBillable = existing.billable;
  const prevAmount = Number(existing.amount);
  const nextBillable = isCostPlus
    ? false
    : parsed.data.billable ?? prevBillable;
  const nextAmount =
    parsed.data.amount !== undefined ? parsed.data.amount : prevAmount;

  // A charge only contributes to the ledger while APPROVED. Editing keeps the
  // status it already had, so an unapproved row contributes zero on BOTH
  // sides of the delta — which makes editing a pending charge automatically
  // free of ledger effects, with no special case.
  const counts = existing.status === "APPROVED";
  const prevBillableAmount = counts && prevBillable ? prevAmount : 0;
  const nextBillableAmount = counts && nextBillable ? nextAmount : 0;
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
            data: { contractAmount: { increment: delta } },
          }),
        ]
      : []),
  ]);

  // balanceDue is derived — recompute it via the single writer. Rollup jobs
  // recompute only when this row actually feeds the contract; an edit to a
  // pending charge changes nothing the sum can see.
  if (isCostPlus && counts) await recomputeCostPlusJob(existing.jobId);
  else if (delta !== 0) await recomputeJobBalance(existing.jobId);

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

  const grants = await getCostGrants(session.user.id);
  if (!canDeleteExpense(session.user.role, grants, existing)) {
    // Distinguish "you lack the grant" from "this row is not ours to delete",
    // because the second is a routing problem, not a permissions one.
    return NextResponse.json(
      {
        error: existing.externalId ? ALLOCATOR_DELETE_MESSAGE : COST_DENIED_MESSAGE,
      },
      { status: 403 },
    );
  }

  const isCostPlus = rollsExpensesIntoContract(existing.job.jobType);
  // Reverse only what was actually applied. Deleting a pending or rejected
  // charge must not decrement a contract it never incremented — that would
  // silently reduce what the customer owes.
  const wasCounted = existing.status === "APPROVED";
  const reverseAmount =
    wasCounted && !isCostPlus && existing.billable ? Number(existing.amount) : 0;

  await prisma.$transaction([
    prisma.jobExpense.delete({ where: { id } }),
    ...(reverseAmount > 0
      ? [
          prisma.job.update({
            where: { id: existing.jobId },
            data: { contractAmount: { decrement: reverseAmount } },
          }),
        ]
      : []),
  ]);

  // balanceDue is derived — recompute it via the single writer. Rollup jobs
  // only need it when the deleted row was in the sum to begin with.
  if (isCostPlus && wasCounted) await recomputeCostPlusJob(existing.jobId);
  else if (reverseAmount > 0) await recomputeJobBalance(existing.jobId);

  return NextResponse.json({ ok: true });
}
