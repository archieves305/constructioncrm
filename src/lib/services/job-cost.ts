import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatAddressLine } from "@/lib/labels/address";
import { computeCostSummary, signedEstimateCost, type CostSummary } from "@/lib/jobs/cost-summary";
import { openCommitmentsByJob } from "@/lib/vendors/commitment-service";

/**
 * The inputs of `computeCostSummary`, gathered for one job or many.
 *
 * One loader for the job page, the Overview tab and the Collections table, so
 * they cannot drift apart again. Only reviewed money counts: APPROVED
 * expenses, RECEIVED payments, issued (SENT / PAID) invoices, APPROVED change
 * orders. Field labor already posted through payroll arrives as an expense,
 * so only the unposted hours are added — the same rule as
 * `getFinancialSummary`.
 */
export type JobCostRow = {
  jobId: string;
  jobNumber: string;
  title: string;
  /** Street + city from the lead; empty when the lead has no real street. */
  address: string;
  jobType: "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";
  closed: boolean;
  summary: CostSummary;
};

const num = (d: unknown) => Number(d ?? 0);

function sumBy<T extends { jobId: string }>(rows: T[], pick: (r: T) => unknown): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.jobId, (m.get(r.jobId) ?? 0) + num(pick(r)));
  return m;
}

export async function getJobCostRows(where: Prisma.JobWhereInput = {}): Promise<JobCostRow[]> {
  const jobs = await prisma.job.findMany({
    where,
    select: {
      id: true,
      jobNumber: true,
      title: true,
      jobType: true,
      contractAmount: true,
      originalContractAmount: true,
      laborCost: true,
      currentStage: { select: { isClosed: true } },
      lead: { select: { propertyAddress1: true, propertyAddress2: true, city: true } },
    },
  });
  if (jobs.length === 0) return [];
  const jobId = { in: jobs.map((j) => j.id) };

  const [changeOrders, expenses, billable, budgets, laborPayments, fieldLabor, invoices, payments, contracts, commitmentsBy] = await Promise.all([
    prisma.changeOrder.groupBy({ by: ["jobId"], where: { jobId, status: "APPROVED" }, _sum: { customerPrice: true } }),
    prisma.jobExpense.groupBy({ by: ["jobId"], where: { jobId, status: "APPROVED" }, _sum: { amount: true } }),
    prisma.jobExpense.groupBy({ by: ["jobId"], where: { jobId, status: "APPROVED", billable: true }, _sum: { amount: true } }),
    prisma.budgetLine.groupBy({ by: ["jobId"], where: { jobId }, _sum: { amount: true } }),
    prisma.laborPayment.findMany({ where: { laborContract: { jobId } }, select: { amount: true, laborContract: { select: { jobId: true } } } }),
    prisma.dailyLaborEntry.groupBy({ by: ["jobId"], where: { jobId, isAbsent: false, payrollPaymentId: null }, _sum: { totalCost: true } }),
    prisma.invoice.groupBy({ by: ["jobId"], where: { jobId, status: { in: ["SENT", "PAID"] } }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["jobId"], where: { jobId, status: "RECEIVED" }, _sum: { amount: true } }),
    // The cost behind the price the customer signed: a fallback "estimated cost" for a job with no budget.
    // A contract comes from exactly one estimate, of either kind: the sectioned
    // estimate or the roofing estimate. Both carry the cost behind their price.
    // (Until 2026-10 only the sectioned kind was read, so a roofing job had no
    // estimated cost unless someone typed a budget.)
    prisma.customerContract.findMany({
      where: { jobId, status: "SIGNED" },
      orderBy: { signedAt: "desc" },
      select: { jobId: true, estimate: { select: { subtotalCost: true } }, roofEstimate: { select: { subtotalCost: true } } },
    }),
    // Promised to vendors and not yet drawn down by an expense.
    openCommitmentsByJob({ jobId }),
  ]);

  const coBy = sumBy(changeOrders, (r) => r._sum.customerPrice);
  const expBy = sumBy(expenses, (r) => r._sum.amount);
  const billBy = sumBy(billable, (r) => r._sum.amount);
  const budgetBy = sumBy(budgets, (r) => r._sum.amount);
  const laborPaidBy = sumBy(laborPayments.map((p) => ({ jobId: p.laborContract.jobId, amount: p.amount })), (r) => r.amount);
  const fieldBy = sumBy(fieldLabor, (r) => r._sum.totalCost);
  const billedBy = sumBy(invoices, (r) => r._sum.amount);
  const paidBy = sumBy(payments, (r) => r._sum.amount);
  const estimateBy = new Map<string, number>();
  for (const c of contracts) {
    const cost = signedEstimateCost(c);
    if (cost !== null && !estimateBy.has(c.jobId)) estimateBy.set(c.jobId, cost);
  }

  return jobs.map((j) => ({
    jobId: j.id,
    jobNumber: j.jobNumber,
    title: j.title,
    address: formatAddressLine(j.lead),
    jobType: j.jobType,
    closed: j.currentStage.isClosed,
    summary: computeCostSummary({
      jobType: j.jobType,
      revisedContract: num(j.contractAmount),
      storedOriginalContract: j.originalContractAmount === null ? null : num(j.originalContractAmount),
      approvedChangeOrders: coBy.get(j.id) ?? 0,
      approvedBillableAddOns: billBy.get(j.id) ?? 0,
      budgetTotal: budgetBy.has(j.id) ? budgetBy.get(j.id)! : null,
      estimateCost: estimateBy.get(j.id) ?? null,
      laborContracts: num(j.laborCost),
      laborPaid: laborPaidBy.get(j.id) ?? 0,
      fieldLaborUnposted: fieldBy.get(j.id) ?? 0,
      expenses: expBy.get(j.id) ?? 0,
      commitmentsOpen: commitmentsBy.get(j.id) ?? 0,
      billedToDate: billedBy.get(j.id) ?? 0,
      collected: paidBy.get(j.id) ?? 0,
    }),
  }));
}

export async function getJobCostSummary(jobId: string): Promise<CostSummary | null> {
  const [row] = await getJobCostRows({ id: jobId });
  return row?.summary ?? null;
}
