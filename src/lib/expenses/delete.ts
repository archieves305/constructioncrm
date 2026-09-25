import type { JobType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { recomputeCostPlusJob, recomputeJobBalance, rollsExpensesIntoContract } from "@/lib/services/job-pricing";

/**
 * The one way an expense leaves the books. Reverses only what was actually
 * applied — a pending or rejected charge never incremented anything — then
 * recomputes the derived balance through its single writer, and records an
 * AuditEvent (the 2026-09-24 reconciliation found three allocator postings
 * gone with no trace).
 */
export type DeletableExpense = {
  id: string;
  jobId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  billable: boolean;
  amount: { toString(): string } | number;
  externalId: string | null;
  vendor: string | null;
  description?: string | null;
  incurredDate: Date;
  type?: string;
};

export async function deleteExpense(
  expense: DeletableExpense,
  jobType: JobType,
  actor: { userId: string | null; reason: string },
): Promise<{ reversed: number }> {
  const isRollup = rollsExpensesIntoContract(jobType);
  const wasCounted = expense.status === "APPROVED";
  const amount = Number(expense.amount);
  const reverseAmount = wasCounted && !isRollup && expense.billable ? amount : 0;

  await prisma.$transaction([
    prisma.jobExpense.delete({ where: { id: expense.id } }),
    ...(reverseAmount !== 0
      ? [prisma.job.update({ where: { id: expense.jobId }, data: { contractAmount: { decrement: reverseAmount } } })]
      : []),
  ]);

  if (isRollup && wasCounted) await recomputeCostPlusJob(expense.jobId);
  else if (reverseAmount !== 0) await recomputeJobBalance(expense.jobId);

  await recordAudit({
    actorUserId: actor.userId,
    entityType: "JobExpense",
    entityId: expense.id,
    action: "expense_delete",
    before: {
      jobId: expense.jobId,
      amount,
      vendor: expense.vendor,
      description: expense.description ?? null,
      incurredDate: expense.incurredDate,
      type: expense.type ?? null,
      status: expense.status,
      billable: expense.billable,
      externalId: expense.externalId,
    },
    after: { reason: actor.reason, reversedContractBy: reverseAmount },
  });

  return { reversed: reverseAmount };
}
