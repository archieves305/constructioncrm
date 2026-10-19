import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { formatAddressLine } from "@/lib/labels/address";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { pairCandidates, pairKey } from "@/lib/expenses/reconcile";
import { classifyAllocatorPostings } from "@/lib/expenses/reconcile-allocator";
import { fetchAllocatorPostings } from "@/lib/integrations/cc-allocator/postings";
import { reviewLaborExpenses, contractName } from "@/lib/expenses/labor-twins";
import { LABOR_CONTRACT_NAME_SELECT, LABOR_EXPENSE_SELECT, toContractRow, toExpenseRow } from "@/lib/expenses/labor-cover";

/**
 * Manual charges that look like a cc-allocator posting on the same job —
 * the pairs a person still has to rule on — plus the recent rulings, and
 * (when cc-allocator's export is configured) the two classes only its side
 * can show: postings it recorded that the CRM no longer holds, and rows
 * linked to a job that never posted. Read-only; decisions go through
 * ./resolve. Same explicit role list as approving a charge: ADMIN,
 * MANAGER, OFFICE_STAFF.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApproveJobCosts(session.user.role)) return forbidden();

  const [rows, decisions, externalRows, allocator] = await Promise.all([
    prisma.jobExpense.findMany({
      where: { status: "APPROVED" },
      select: {
        id: true,
        jobId: true,
        amount: true,
        incurredDate: true,
        vendor: true,
        description: true,
        type: true,
        billable: true,
        externalId: true,
        payrollPaymentId: true,
        status: true,
        createdAt: true,
        createdByUserId: true,
        createdBy: { select: { firstName: true, lastName: true } },
        job: { select: { ...JOB_LABEL_SELECT, jobType: true } },
      },
    }),
    prisma.expenseReconciliation.findMany({
      orderBy: { decidedAt: "desc" },
      include: { decidedBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.jobExpense.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true, status: true } }),
    fetchAllocatorPostings(),
  ]);
  const acks = await prisma.allocatorPostingAck.findMany({
    include: { decidedBy: { select: { firstName: true, lastName: true } } },
    orderBy: { decidedAt: "desc" },
  });
  const ackByExt = new Map(acks.map((a) => [a.externalId, a]));

  // cc-allocator's side, with CRM job numbers attached where the id resolves.
  let allocatorOut: Record<string, unknown> = { configured: false };
  if (allocator.configured && !allocator.ok) allocatorOut = { configured: true, ok: false, error: allocator.error };
  if (allocator.configured && allocator.ok) {
    const classes = classifyAllocatorPostings(
      allocator.data.postings,
      externalRows.map((r) => ({ id: r.id, externalId: r.externalId as string, status: r.status })),
      new Set(ackByExt.keys()),
    );
    const jobIds = Array.from(new Set([...classes.missingInCrm, ...classes.acknowledged, ...classes.neverPosted, ...classes.heldPending].map((p) => p.crmJobId).filter((x): x is string => Boolean(x))));
    const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true } });
    const jobNo = new Map(jobs.map((j) => [j.id, j.jobNumber]));
    const withJob = <T extends { crmJobId: string | null }>(p: T) => ({ ...p, jobNumber: p.crmJobId ? (jobNo.get(p.crmJobId) ?? null) : null });
    allocatorOut = {
      configured: true,
      ok: true,
      generatedAt: allocator.data.generatedAt,
      counts: allocator.data.counts,
      missingInCrm: classes.missingInCrm.map(withJob),
      acknowledged: classes.acknowledged.map((p) => {
        const a = ackByExt.get(p.externalId);
        return {
          ...withJob(p),
          ack: a
            ? { note: a.note, decidedAt: a.decidedAt.toISOString(), decidedBy: a.decidedBy ? `${a.decidedBy.firstName} ${a.decidedBy.lastName}`.trim() : null }
            : null,
        };
      }),
      neverPosted: classes.neverPosted.map(withJob),
      heldPending: classes.heldPending.map(withJob),
      totals: classes.totals,
    };
  }

  const decided = new Set(decisions.map((d) => pairKey(d.manualExpenseId, d.externalExpenseId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pairs = pairCandidates(
    rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    decided,
  ).map((p) => {
    const m = byId.get(p.manual.id)!;
    const x = byId.get(p.external.id)!;
    const side = (r: typeof m) => ({
      id: r.id,
      vendor: r.vendor,
      description: r.description,
      type: r.type,
      billable: r.billable,
      incurredDate: r.incurredDate.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
      enteredBy: `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim(),
    });
    return {
      key: p.key,
      jobId: m.jobId,
      jobNumber: m.job.jobNumber,
      jobAddress: formatAddressLine(m.job.lead) || null,
      jobTitle: m.job.title,
      jobType: m.job.jobType,
      amount: Number(m.amount),
      gapDays: p.gapDays,
      exact: p.exact,
      source: p.source,
      manual: side(m),
      external: side(x),
    };
  });

  const crew = await loadCrewPayments();

  return NextResponse.json({
    allocator: allocatorOut,
    crew,
    pairs,
    summary: {
      pairs: pairs.length,
      exact: pairs.filter((p) => p.exact).length,
      amount: Math.round(pairs.reduce((s, p) => s + p.amount, 0) * 100) / 100,
    },
    decisions: decisions.slice(0, 50).map((d) => ({
      id: d.id,
      decision: d.decision,
      jobId: d.jobId,
      amount: Number(d.amount),
      manualVendor: d.manualVendor,
      externalVendor: d.externalVendor,
      manualIncurredOn: d.manualIncurredOn.toISOString().slice(0, 10),
      externalIncurredOn: d.externalIncurredOn.toISOString().slice(0, 10),
      note: d.note,
      decidedAt: d.decidedAt.toISOString(),
      decidedBy: d.decidedBy ? `${d.decidedBy.firstName} ${d.decidedBy.lastName}`.trim() : null,
    })),
  });
}

/**
 * Crew payments counted twice: charges that look like a payment already on
 * a crew's labor contract, and charges paid to a crew with a labor contract
 * on the job but no payment recorded (lib/expenses/labor-twins.ts).
 */
async function loadCrewPayments() {
  const contracts = await prisma.laborContract.findMany({ select: LABOR_CONTRACT_NAME_SELECT });
  if (!contracts.length) return { twins: [], crewPaidAsExpense: [] };
  const jobIds = Array.from(new Set(contracts.map((c) => c.jobId)));
  const [expenses, payments, covering, jobs] = await Promise.all([
    prisma.jobExpense.findMany({
      where: { jobId: { in: jobIds }, status: { not: "REJECTED" }, amount: { gt: 0 }, payrollPaymentId: null, coveredByLaborPaymentId: null, laborClearedAt: null },
      select: { ...LABOR_EXPENSE_SELECT, externalId: true },
    }),
    prisma.laborPayment.findMany({ where: { laborContractId: { in: contracts.map((c) => c.id) } }, select: { id: true, laborContractId: true, amount: true, paidDate: true } }),
    prisma.jobExpense.findMany({ where: { coveredByLaborPaymentId: { not: null } }, select: { coveredByLaborPaymentId: true } }),
    prisma.job.findMany({ where: { id: { in: jobIds } }, select: JOB_LABEL_SELECT }),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const review = reviewLaborExpenses(
    expenses.map(toExpenseRow),
    payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    contracts.map(toContractRow),
    new Set(covering.map((c) => c.coveredByLaborPaymentId as string)),
  );
  const bankIds = new Set(expenses.filter((e) => e.externalId).map((e) => e.id));
  const expenseOut = (e: (typeof review.twins)[number]["expense"]) => {
    const j = jobById.get(e.jobId);
    return {
      id: e.id,
      jobId: e.jobId,
      jobNumber: j?.jobNumber ?? null,
      jobAddress: j ? formatAddressLine(j.lead) || null : null,
      amount: e.amount,
      incurredDate: e.incurredDate.toISOString().slice(0, 10),
      vendor: e.vendor,
      status: e.status,
      fromBank: bankIds.has(e.id),
    };
  };
  return {
    twins: review.twins.map(({ expense, twin }) => ({
      expense: expenseOut(expense),
      payment: { id: twin.payment.id, amount: twin.payment.amount, paidDate: twin.payment.paidDate.toISOString().slice(0, 10), crew: contractName(twin.contract) },
      difference: twin.difference,
      gapDays: twin.gapDays,
      reason: twin.reason,
    })),
    crewPaidAsExpense: review.crewPaidAsExpense.map(({ expense, contract }) => ({
      expense: expenseOut(expense),
      contract: { id: contract.id, crew: contractName(contract) },
    })),
  };
}
