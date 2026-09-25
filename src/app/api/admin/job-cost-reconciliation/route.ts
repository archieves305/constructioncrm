import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { pairCandidates, pairKey } from "@/lib/expenses/reconcile";

/**
 * Manual charges that look like a cc-allocator posting on the same job —
 * the pairs a person still has to rule on — plus the recent rulings.
 * Read-only; decisions go through ./resolve. Same explicit role list as
 * approving a charge: ADMIN, MANAGER, OFFICE_STAFF.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApproveJobCosts(session.user.role)) return forbidden();

  const [rows, decisions] = await Promise.all([
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
  ]);

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
