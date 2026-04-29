import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyCcAllocatorAuth } from "@/lib/integrations/cc-allocator/auth";
import { CC_ALLOCATOR_SYSTEM_USER_ID } from "@/lib/integrations/cc-allocator/system-user";
import { recomputeCostPlusJob } from "@/lib/services/job-pricing";

// POST /api/integrations/cc-allocator/expense
//
// Idempotent on `externalId` — a retried POST with the same externalId
// returns the prior expenseId with alreadyExists=true and does not
// double-write. cc-allocator's worker passes its Transaction.id, so the
// retry-on-network-blip path is safe.
//
// Mirrors the balance-update behavior of PATCH /api/expenses/[id]:
//   - For non-COST_PLUS jobs, billable=true expenses increment
//     job.contractAmount and job.balanceDue by the amount.
//   - For COST_PLUS jobs, billable is forced to false and the contract is
//     recomputed from labor + expensesTotal + margin via
//     recomputeCostPlusJob.
//
// Skipping either branch silently corrupts the job's balance state.

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

const inputSchema = z.object({
  externalId: z.string().min(1).max(200),
  jobId: z.string().min(1),
  type: z.enum(TYPES),
  amount: z.number().positive().finite(),
  incurredDate: z.string().datetime(),
  vendor: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  paidMethod: z.enum(METHODS).optional(),
  paidFrom: z.string().max(120).nullable().optional(),
  billable: z.boolean(),
});

export async function POST(request: NextRequest) {
  const authFail = verifyCcAllocatorAuth(request);
  if (authFail) return authFail;

  const body = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "invalid payload" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Idempotency: a prior POST with the same externalId returns the
  // existing row instead of creating a duplicate.
  const existing = await prisma.jobExpense.findUnique({
    where: { externalId: input.externalId },
    select: { id: true, jobId: true },
  });
  if (existing) {
    return NextResponse.json({
      expenseId: existing.id,
      jobId: existing.jobId,
      alreadyExists: true,
    });
  }

  const job = await prisma.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, jobType: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const isCostPlus = job.jobType === "COST_PLUS";
  // COST_PLUS jobs ignore the per-expense billable flag — the contract is
  // recomputed from the expense pool. Mirrors PATCH /api/expenses/[id].
  const effectiveBillable = isCostPlus ? false : input.billable;
  const balanceDelta = !isCostPlus && effectiveBillable ? input.amount : 0;

  const created = await prisma.$transaction(async (tx) => {
    const expense = await tx.jobExpense.create({
      data: {
        jobId: input.jobId,
        type: input.type,
        amount: input.amount,
        incurredDate: new Date(input.incurredDate),
        vendor: input.vendor?.trim() || null,
        description: input.description?.trim() || null,
        paidMethod: input.paidMethod ?? null,
        paidFrom: input.paidFrom?.trim() || null,
        billable: effectiveBillable,
        createdByUserId: CC_ALLOCATOR_SYSTEM_USER_ID,
        externalId: input.externalId,
      },
      select: { id: true, jobId: true },
    });
    if (balanceDelta > 0) {
      await tx.job.update({
        where: { id: input.jobId },
        data: {
          contractAmount: { increment: balanceDelta },
          balanceDue: { increment: balanceDelta },
        },
      });
    }
    return expense;
  });

  // recomputeCostPlusJob is tx-aware but reads its own data; running it
  // outside the transaction matches PATCH /api/expenses/[id]'s pattern.
  if (isCostPlus) await recomputeCostPlusJob(input.jobId);

  return NextResponse.json({
    expenseId: created.id,
    jobId: created.jobId,
    alreadyExists: false,
  });
}
