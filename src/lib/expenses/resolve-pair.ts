import type { ExpenseReconcileDecision } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deleteExpense } from "./delete";
import { dayGap, TWIN_WINDOW_DAYS } from "./reconcile";

/**
 * Rule on one manual↔allocator pair. DUPLICATE deletes the manual row
 * (audited, contract reversed) and records the decision; KEEP records it so
 * the pair stops appearing. Shared by the admin route and the one-off
 * backout script so both leave the same trail.
 */
export type ResolveResult =
  | { ok: true; decision: ExpenseReconcileDecision; deletedManualId: string | null; reversed: number }
  | { ok: false; status: 404 | 409 | 400; error: string };

export async function resolvePair(
  input: { manualExpenseId: string; externalExpenseId: string; decision: ExpenseReconcileDecision; note?: string | null },
  actor: { userId: string | null },
): Promise<ResolveResult> {
  const [manual, external] = await Promise.all([
    prisma.jobExpense.findUnique({ where: { id: input.manualExpenseId }, include: { job: { select: { jobType: true } } } }),
    prisma.jobExpense.findUnique({ where: { id: input.externalExpenseId } }),
  ]);
  if (!manual || !external) return { ok: false, status: 404, error: "One of the two charges no longer exists" };
  if (manual.externalId || manual.payrollPaymentId) return { ok: false, status: 400, error: "The first charge is not a manual entry" };
  if (!external.externalId) return { ok: false, status: 400, error: "The second charge did not come from cc-allocator" };
  if (manual.jobId !== external.jobId) return { ok: false, status: 400, error: "The two charges are on different jobs" };
  if (Number(manual.amount) !== Number(external.amount)) return { ok: false, status: 400, error: "The two charges are for different amounts" };
  if (dayGap(manual.incurredDate, external.incurredDate) > TWIN_WINDOW_DAYS) return { ok: false, status: 400, error: `The two charges are more than ${TWIN_WINDOW_DAYS} days apart` };
  const already = await prisma.expenseReconciliation.findUnique({
    where: { manualExpenseId_externalExpenseId: { manualExpenseId: manual.id, externalExpenseId: external.id } },
  });
  if (already) return { ok: false, status: 409, error: `Already ruled ${already.decision.toLowerCase()} on ${already.decidedAt.toISOString().slice(0, 10)}` };

  let reversed = 0;
  if (input.decision === "DUPLICATE") {
    reversed = (
      await deleteExpense(manual, manual.job.jobType, {
        userId: actor.userId,
        reason: `duplicate of cc-allocator posting ${external.id} (${external.externalId})`,
      })
    ).reversed;
  }
  await prisma.expenseReconciliation.create({
    data: {
      manualExpenseId: manual.id,
      externalExpenseId: external.id,
      decision: input.decision,
      jobId: manual.jobId,
      amount: manual.amount,
      manualVendor: manual.vendor,
      externalVendor: external.vendor,
      manualIncurredOn: manual.incurredDate,
      externalIncurredOn: external.incurredDate,
      note: input.note?.trim() || null,
      decidedByUserId: actor.userId,
    },
  });
  return { ok: true, decision: input.decision, deletedManualId: input.decision === "DUPLICATE" ? manual.id : null, reversed };
}
