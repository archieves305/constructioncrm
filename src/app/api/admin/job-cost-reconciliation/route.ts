import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { pairCandidates, pairKey } from "@/lib/expenses/reconcile";
import { classifyAllocatorPostings } from "@/lib/expenses/reconcile-allocator";
import { fetchAllocatorPostings } from "@/lib/integrations/cc-allocator/postings";

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
        job: { select: { jobNumber: true, title: true, jobType: true } },
      },
    }),
    prisma.expenseReconciliation.findMany({
      orderBy: { decidedAt: "desc" },
      include: { decidedBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.jobExpense.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true, status: true } }),
    fetchAllocatorPostings(),
  ]);

  // cc-allocator's side, with CRM job numbers attached where the id resolves.
  let allocatorOut: Record<string, unknown> = { configured: false };
  if (allocator.configured && !allocator.ok) allocatorOut = { configured: true, ok: false, error: allocator.error };
  if (allocator.configured && allocator.ok) {
    const classes = classifyAllocatorPostings(
      allocator.data.postings,
      externalRows.map((r) => ({ id: r.id, externalId: r.externalId as string, status: r.status })),
    );
    const jobIds = Array.from(new Set([...classes.missingInCrm, ...classes.neverPosted, ...classes.heldPending].map((p) => p.crmJobId).filter((x): x is string => Boolean(x))));
    const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true } });
    const jobNo = new Map(jobs.map((j) => [j.id, j.jobNumber]));
    const withJob = <T extends { crmJobId: string | null }>(p: T) => ({ ...p, jobNumber: p.crmJobId ? (jobNo.get(p.crmJobId) ?? null) : null });
    allocatorOut = {
      configured: true,
      ok: true,
      generatedAt: allocator.data.generatedAt,
      counts: allocator.data.counts,
      missingInCrm: classes.missingInCrm.map(withJob),
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

  return NextResponse.json({
    allocator: allocatorOut,
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
