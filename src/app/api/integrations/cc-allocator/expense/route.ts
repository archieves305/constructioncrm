import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveVendorId } from "@/lib/vendors/service";
import { autoCommitmentId } from "@/lib/vendors/commitment-service";
import { verifyCcAllocatorAuth } from "@/lib/integrations/cc-allocator/auth";
import { CC_ALLOCATOR_SYSTEM_USER_ID } from "@/lib/integrations/cc-allocator/system-user";
import {
  recomputeCostPlusJob,
  recomputeJobBalance,
  rollsExpensesIntoContract,
} from "@/lib/services/job-pricing";
import { findManualTwin, twinReviewNote, TWIN_WINDOW_DAYS } from "@/lib/expenses/reconcile";
import { laborHoldNote } from "@/lib/expenses/labor-cover";
import { recordAudit } from "@/lib/audit/record";
import { ALLOCATOR_STATUS_SELECT, replayOutcome } from "@/lib/integrations/cc-allocator/status";
import { crewPaymentForExternalId, takeCrewPaymentLine } from "@/lib/labor/allocator-link-run";

// POST /api/integrations/cc-allocator/expense
//
// Idempotent on `externalId` — a retried POST with the same externalId
// returns the prior expense with alreadyExists=true and its current status
// (PENDING / APPROVED / REJECTED, hold reason, note) and does not
// double-write; two concurrent posts that race past the read are answered the
// same way (unique violation → replay). A replay naming a different job is
// refused 409 `external_id_conflict`: the CRM never moves a posted cost
// silently. cc-allocator's worker passes its Transaction.id (card) or
// `bank:<id>`, so the retry-on-network-blip path is safe.
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
//   - A posting that looks like a crew payment already recorded on one of the
//     job's labor contracts — or that pays a crew with a labor contract on the
//     job at all — is held PENDING the same way (2026-10-14: 2188 Windtrace
//     counted three BNW payments twice). Cost Reconciliation → Crew payments
//     takes it from there.
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
  // Crew mode (crew payments, one posting): the line IS a crew payment. It is
  // linked to the CRM crew payment (`laborPaymentId`) or recorded on the crew's
  // labor contract (`laborContractId`, settling `requestId` or the one open
  // request close in amount) — never created as a job expense.
  crewPayment: z
    .object({
      laborPaymentId: z.string().min(1).nullable().optional(),
      laborContractId: z.string().min(1).nullable().optional(),
      requestId: z.string().min(1).nullable().optional(),
    })
    .refine((c) => Boolean(c.laborPaymentId) !== Boolean(c.laborContractId), "crewPayment needs exactly one of laborPaymentId or laborContractId")
    .nullable()
    .optional(),
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

  // A line CC Allocator already sent as a crew payment answers the same way,
  // whichever mode the retry uses.
  const crewReplay = await crewPaymentForExternalId(input.externalId);
  if (crewReplay || input.crewPayment) {
    if (!crewReplay) {
      const asExpense = await prisma.jobExpense.findUnique({ where: { externalId: input.externalId }, select: ALLOCATOR_STATUS_SELECT });
      if (asExpense)
        return NextResponse.json(
          { error: "external_id_conflict", message: "The CRM already holds this line as a job expense. Decide it under Cost Reconciliation → Crew payments.", expenseId: asExpense.id, existingJobId: asExpense.jobId },
          { status: 409 },
        );
    }
    const res = await takeCrewPaymentLine({
      externalId: input.externalId,
      jobId: input.jobId,
      amount: input.amount,
      incurredDate: new Date(input.incurredDate),
      paidMethod: input.paidMethod ?? null,
      paidFrom: input.paidFrom ?? null,
      vendor: input.vendor ?? null,
      laborPaymentId: input.crewPayment?.laborPaymentId ?? null,
      laborContractId: input.crewPayment?.laborContractId ?? null,
      requestId: input.crewPayment?.requestId ?? null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({
      kind: "crew_payment",
      laborPaymentId: res.laborPaymentId,
      jobId: input.jobId,
      expenseId: null,
      alreadyExists: res.alreadyExists,
      created: res.created,
      requestSettled: res.requestSettled,
    });
  }

  // Idempotency: a prior POST with the same externalId returns the
  // existing row instead of creating a duplicate.
  const existing = await prisma.jobExpense.findUnique({
    where: { externalId: input.externalId },
    select: ALLOCATOR_STATUS_SELECT,
  });
  if (existing) return replayResponse(existing, input.jobId);

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
  // A bank memo for a known payee attaches to its vendor; the memo is kept.
  const vendorId = await resolveVendorId(input.vendor);
  const laborNote = twin
    ? null
    : await laborHoldNote({ jobId: input.jobId, amount: input.amount, incurredDate, vendor: input.vendor ?? null, description: input.description ?? null, vendorId });
  const status = twin || laborNote ? "PENDING" : "APPROVED";
  // Only an APPROVED charge moves money. Signed, so a credit backs out what
  // a charge of the same size put in.
  const balanceDelta = status === "APPROVED" && !isRollup && effectiveBillable ? input.amount : 0;

  // One open commitment for that vendor on this job: the posting draws it down.
  const commitmentId = await autoCommitmentId(input.jobId, vendorId);

  const holdReason = twin ? "TWIN" : laborNote ? "LABOR" : null;
  let created: { id: string; jobId: string };
  try {
  created = await prisma.$transaction(async (tx) => {
    const expense = await tx.jobExpense.create({
      data: {
        jobId: input.jobId,
        vendorId,
        commitmentId,
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
        holdReason,
        reviewNote: twin ? twinReviewNote(twin) : laborNote,
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
  } catch (e) {
    // A concurrent post of the same charge won the race: answer as a replay.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const winner = await prisma.jobExpense.findUnique({ where: { externalId: input.externalId }, select: ALLOCATOR_STATUS_SELECT });
      if (winner) return replayResponse(winner, input.jobId);
    }
    throw e;
  }

  // recomputeCostPlusJob is tx-aware but reads its own data; running it
  // outside the transaction matches PATCH /api/expenses/[id]'s pattern.
  // balanceDue is derived — recompute it via the single writer. A pending
  // row is not in any sum yet, so nothing to recompute.
  if (status === "APPROVED") {
    if (isRollup) await recomputeCostPlusJob(input.jobId);
    else if (balanceDelta !== 0) await recomputeJobBalance(input.jobId);
  }

  await recordAudit({
    actorUserId: CC_ALLOCATOR_SYSTEM_USER_ID,
    entityType: "JobExpense",
    entityId: created.id,
    action: "expense_posted_by_allocator",
    after: { externalId: input.externalId, jobId: input.jobId, amount: input.amount, type: input.type, billable: effectiveBillable, status, holdReason, movedContract: balanceDelta },
  });

  return NextResponse.json({
    expenseId: created.id,
    jobId: created.jobId,
    alreadyExists: false,
    status,
    holdReason,
    note: twin ? twinReviewNote(twin) : laborNote,
    suspectedDuplicateOf: twin?.id ?? null,
    heldForCrewPayment: Boolean(laborNote),
  });
}

function replayResponse(existing: Parameters<typeof replayOutcome>[0], requestedJobId: string) {
  const outcome = replayOutcome(existing, requestedJobId);
  return NextResponse.json(outcome.body, { status: outcome.kind === "conflict" ? 409 : 200 });
}
