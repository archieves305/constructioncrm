import { prisma } from "@/lib/db/prisma";
import type { JobType, MarginType } from "@/generated/prisma/client";

export type CostPlusInputs = {
  laborCost: number;
  expensesTotal: number;
  marginType: MarginType | null;
  marginValue: number;
};

/**
 * Job types whose contract is a rollup of labor + expenses (recomputed as
 * expenses change) rather than a directly-entered fixed price. COST_PLUS adds
 * a margin on top; OWNED_REHAB is a cost-only job (no margin, never billed).
 */
export function rollsExpensesIntoContract(
  jobType: JobType | string | null | undefined,
): boolean {
  return jobType === "COST_PLUS" || jobType === "OWNED_REHAB";
}

export function computeCostPlusContract({
  laborCost,
  expensesTotal,
  marginType,
  marginValue,
}: CostPlusInputs): { contract: number; margin: number } {
  const base = laborCost + expensesTotal;
  if (marginType === "FLAT") {
    return { contract: base + marginValue, margin: marginValue };
  }
  if (marginType === "PERCENT") {
    const margin = base * (marginValue / 100);
    return { contract: base + margin, margin };
  }
  return { contract: base, margin: 0 };
}

export async function recomputeCostPlusJob(jobId: string, tx = prisma) {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      jobType: true,
      laborCost: true,
      marginType: true,
      marginValue: true,
      depositReceived: true,
    },
  });
  if (!job || !rollsExpensesIntoContract(job.jobType)) return;

  const isOwnedRehab = job.jobType === ("OWNED_REHAB" as JobType);

  const expenses = await tx.jobExpense.findMany({
    where: { jobId },
    select: { amount: true },
  });
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);

  // Owned-rehab jobs are cost-only: total cost = labor + expenses, no margin.
  const { contract } = computeCostPlusContract({
    laborCost: Number(job.laborCost ?? 0),
    expensesTotal,
    marginType: isOwnedRehab ? null : job.marginType,
    marginValue: isOwnedRehab ? 0 : Number(job.marginValue ?? 0),
  });

  const payments = await tx.payment.findMany({
    where: { jobId, status: "RECEIVED" },
    select: { amount: true },
  });
  const totalReceived = payments.reduce((s, p) => s + Number(p.amount), 0);

  await tx.job.update({
    where: { id: jobId },
    data: {
      contractAmount: contract,
      // Owned-rehab jobs are never billed to a client.
      balanceDue: isOwnedRehab ? 0 : Math.max(0, contract - totalReceived),
    },
  });
}

/**
 * Recompute a job's labor from its per-crew labor contracts (revised totals =
 * each contract amount + its change orders). Once any labor contract exists,
 * the crew-contract sum becomes the job's effective labor (denormalized into
 * Job.laborCost so all existing reads stay correct). For rollup jobs this then
 * recomputes the contract/balance; for fixed-price, laborCost is used only to
 * reduce estimated profit. With zero contracts, laborCost is left to the
 * Pricing panel's single-value input.
 */
export async function recomputeJobLabor(jobId: string, tx = prisma) {
  const contracts = await tx.laborContract.findMany({
    where: { jobId },
    select: {
      contractAmount: true,
      changeOrders: { select: { amount: true } },
    },
  });
  if (contracts.length > 0) {
    const laborTotal = contracts.reduce(
      (s, c) =>
        s +
        Number(c.contractAmount) +
        c.changeOrders.reduce((cs, co) => cs + Number(co.amount), 0),
      0,
    );
    await tx.job.update({ where: { id: jobId }, data: { laborCost: laborTotal } });
  }
  await recomputeCostPlusJob(jobId, tx);
}
