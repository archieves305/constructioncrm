import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { recordAudit } from "@/lib/audit/record";
import {
  recomputeCostPlusJob,
  recomputeJobBalance,
  rollsExpensesIntoContract,
} from "@/lib/services/job-pricing";

/**
 * Approve or reject a pending charge.
 *
 * This is the moment a charge becomes real money: approval is the ONLY path
 * that moves a pending row into `contractAmount` / the cost-plus rollup, and
 * it mirrors exactly what `POST /api/jobs/[id]/expenses` would have done had
 * the charge been approved on entry.
 *
 * Deliberately one-way. There is no un-approve: reversing an approval means
 * unwinding a contract increment that invoices may already reflect, and a
 * delete (which reverses cleanly) already covers the mistake case.
 */
const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (!canApproveJobCosts(session.user.role)) {
    return NextResponse.json(
      { error: "Only Admin, Manager or Accounting can approve job charges." },
      { status: 403 },
    );
  }

  const parsed = await validateBody(request, reviewSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await context.params;
  const existing = await prisma.jobExpense.findUnique({
    where: { id },
    include: { job: { select: { jobType: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.status !== "PENDING") {
    // Not an error worth failing a queue over — two people clicking the same
    // row should not produce a scary message — but do not re-apply the money.
    return NextResponse.json(
      {
        error: `This charge is already ${existing.status.toLowerCase()}.`,
        status: existing.status,
      },
      { status: 409 },
    );
  }

  const approving = parsed.data.decision === "APPROVE";
  const isRollup = rollsExpensesIntoContract(existing.job.jobType);
  const amount = Number(existing.amount);
  // Same rule as creation: rollup jobs ignore `billable` and recompute the
  // contract from the approved-expense pool instead.
  const increments = approving && !isRollup && existing.billable;

  await prisma.$transaction([
    prisma.jobExpense.update({
      where: { id },
      data: {
        status: approving ? "APPROVED" : "REJECTED",
        approvedByUserId: session.user.id,
        approvedAt: new Date(),
        reviewNote: parsed.data.note?.trim() || null,
      },
    }),
    ...(increments
      ? [
          prisma.job.update({
            where: { id: existing.jobId },
            data: { contractAmount: { increment: amount } },
          }),
        ]
      : []),
  ]);

  // Derived values, via the single writer. Only an approval can change them —
  // a rejected charge never entered the sum.
  if (approving && isRollup) await recomputeCostPlusJob(existing.jobId);
  else if (increments) await recomputeJobBalance(existing.jobId);

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "JobExpense",
    entityId: id,
    action: approving ? "expense_approved" : "expense_rejected",
    before: { status: existing.status },
    after: {
      status: approving ? "APPROVED" : "REJECTED",
      amount,
      jobId: existing.jobId,
      billable: existing.billable,
      movedContract: increments ? amount : 0,
      note: parsed.data.note?.trim() || null,
    },
  });

  const record = await prisma.jobExpense.findUnique({
    where: { id },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      approvedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(record);
}
