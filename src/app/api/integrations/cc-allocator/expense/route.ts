import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyCcAllocatorAuth } from "@/lib/integrations/cc-allocator/auth";
import { CC_ALLOCATOR_SYSTEM_USER_ID } from "@/lib/integrations/cc-allocator/system-user";
import {
  recomputeCostPlusJob,
  recomputeJobBalance,
  rollsExpensesIntoContract,
} from "@/lib/services/job-pricing";
import { findManualTwin, twinReviewNote, TWIN_WINDOW_DAYS } from "@/lib/expenses/reconcile";

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
//
// Two rules from the 2026-09-24 reconciliation:
//   - A posting that looks like a manual charge already on the job (same
//     amount, within ±3 days) is created PENDING with a review note instead
//     of APPROVED. Pending moves no money; the review queue shows it; the
//     reviewer approves (both real) or deletes the manual twin.
//   - Negative amounts are accepted from this route only — card refunds and
//     returns. They flow through the same increments with the opposite
//     sign, so a credit reduces job cost the way the charge raised it.

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
  // Negative = a credit / return from the card feed. Zero is meaningless.
  amount: z.number().finite().refine((a) => a !== 0, "amount must not be zero"),
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

  const isRollup = rollsExpensesIntoContract(job.jobType);
  // Rollup jobs (cost-plus / owned-rehab) ignore the per-expense billable flag —
  // the contract is recomputed from the expense pool. Mirrors PATCH /api/expenses/[id].
  const effectiveBillable = isRollup ? false : input.billable;
  const incurredDate = new Date(input.incurredDate);

  // Possible duplicate of a manual charge? Hold it for review instead of
  // approving it. Credits are never held — nothing is typed in twice as a
  // refund.
  let twin: Awaited<ReturnType<typeof findManualTwin>> = null;
  if (input.amount > 0) {
    const windowMs = TWIN_WINDOW_DAYS * 86_400_000;
    const nearby = await prisma.jobExpense.findMany({
      where: {
        jobId: input.jobId,
        externalId: null,
        payrollPaymentId: null,
        status: "APPROVED",
        amount: input.amount,
        incurredDate: { gte: new Date(incurredDate.getTime() - windowMs - 86_400_000), lte: new Date(incurredDate.getTime() + windowMs + 86_400_000) },
      },
      select: { id: true, jobId: true, amount: true, incurredDate: true, vendor: true, externalId: true, payrollPaymentId: true, status: true, createdAt: true, createdByUserId: true },
    });
    twin = findManualTwin(
      { jobId: input.jobId, amount: input.amount, incurredDate },
      nearby.map((r) => ({ ...r, amount: Number(r.amount) })),
    );
  }
  const status = twin ? "PENDING" : "APPROVED";
  // Only an APPROVED charge moves money. Signed, so a credit backs out what
  // a charge of the same size put in.
  const balanceDelta = status === "APPROVED" && !isRollup && effectiveBillable ? input.amount : 0;

  const created = await prisma.$transaction(async (tx) => {
    const expense = await tx.jobExpense.create({
      data: {
        jobId: input.jobId,
        type: input.type,
        amount: input.amount,
        incurredDate,
        vendor: input.vendor?.trim() || null,
        description: input.description?.trim() || null,
        paidMethod: input.paidMethod ?? null,
        paidFrom: input.paidFrom?.trim() || null,
        billable: effectiveBillable,
        createdByUserId: CC_ALLOCATOR_SYSTEM_USER_ID,
        externalId: input.externalId,
        status,
        reviewNote: twin ? twinReviewNote(twin) : null,
      },
      select: { id: true, jobId: true },
    });
    if (balanceDelta !== 0) {
      await tx.job.update({
        where: { id: input.jobId },
        data: { contractAmount: { increment: balanceDelta } },
      });
    }
    return expense;
  });

  // recomputeCostPlusJob is tx-aware but reads its own data; running it
  // outside the transaction matches PATCH /api/expenses/[id]'s pattern.
  // balanceDue is derived — recompute it via the single writer. A pending
  // row is not in any sum yet, so nothing to recompute.
  if (status === "APPROVED") {
    if (isRollup) await recomputeCostPlusJob(input.jobId);
    else if (balanceDelta !== 0) await recomputeJobBalance(input.jobId);
  }

  return NextResponse.json({
    expenseId: created.id,
    jobId: created.jobId,
    alreadyExists: false,
    status,
    suspectedDuplicateOf: twin?.id ?? null,
  });
}
