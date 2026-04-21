import { prisma } from "@/lib/db/prisma";
import type { JobType, MarginType } from "@/generated/prisma/client";

export type CostPlusInputs = {
  laborCost: number;
  expensesTotal: number;
  marginType: MarginType | null;
  marginValue: number;
};

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
  if (!job || job.jobType !== ("COST_PLUS" as JobType)) return;

  const expenses = await tx.jobExpense.findMany({
    where: { jobId },
    select: { amount: true },
  });
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const { contract } = computeCostPlusContract({
    laborCost: Number(job.laborCost ?? 0),
    expensesTotal,
    marginType: job.marginType,
    marginValue: Number(job.marginValue ?? 0),
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
      balanceDue: Math.max(0, contract - totalReceived),
    },
  });
}
