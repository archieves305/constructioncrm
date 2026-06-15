import { prisma } from "@/lib/db/prisma";

const MS_PER_DAY = 86400000;

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

export type ArAgingRow = {
  invoiceId: string;
  invoiceNumber: string;
  jobId: string;
  jobNumber: string;
  customer: string;
  remaining: number;
  dueDate: string | null;
  ageDays: number; // days past due (0 if not yet due)
  bucket: AgingBucket;
};

export type ArAging = {
  rows: ArAgingRow[];
  buckets: Record<AgingBucket, number>;
  totalOutstanding: number;
  totalOverdue: number;
};

function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 0) return "current";
  if (ageDays <= 30) return "d1_30";
  if (ageDays <= 60) return "d31_60";
  if (ageDays <= 90) return "d61_90";
  return "d90plus";
}

/**
 * Accounts-receivable aging from unpaid invoices. The receivable is an invoice
 * in SENT status with payments not yet covering it; each is aged by days past
 * its due date (falling back to issue date) and bucketed. PAID/VOID/DRAFT
 * invoices are excluded.
 */
export async function getArAging(now = new Date()): Promise<ArAging> {
  const invoices = await prisma.invoice.findMany({
    where: { status: "SENT" },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      dueDate: true,
      issueDate: true,
      jobId: true,
      job: { select: { jobNumber: true, lead: { select: { fullName: true } } } },
      payments: { where: { status: "RECEIVED" }, select: { amount: true } },
    },
  });

  const rows: ArAgingRow[] = [];
  const buckets: Record<AgingBucket, number> = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90plus: 0,
  };
  let totalOutstanding = 0;
  let totalOverdue = 0;

  for (const inv of invoices) {
    const applied = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Number(inv.amount) - applied;
    if (remaining <= 0) continue;

    const ref = inv.dueDate ?? inv.issueDate;
    const ageDays = Math.max(
      0,
      Math.floor((now.getTime() - ref.getTime()) / MS_PER_DAY),
    );
    const bucket = bucketFor(ageDays);

    buckets[bucket] += remaining;
    totalOutstanding += remaining;
    if (ageDays > 0) totalOverdue += remaining;

    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      jobId: inv.jobId,
      jobNumber: inv.job.jobNumber,
      customer: inv.job.lead.fullName,
      remaining,
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
      ageDays,
      bucket,
    });
  }

  rows.sort((a, b) => b.ageDays - a.ageDays);
  return { rows, buckets, totalOutstanding, totalOverdue };
}

export type JobProfitability = {
  jobId: string;
  jobNumber: string;
  title: string;
  jobType: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // fraction, e.g. 0.18
};

export type FinancialSummary = {
  totalContracted: number;
  totalCollected: number;
  totalOutstandingAR: number;
  jobs: JobProfitability[];
};

/**
 * Company financial summary: contracted/collected/outstanding totals plus
 * per-job profitability (revenue − labor − expenses). Owned-rehab jobs are
 * excluded from profitability since they're never billed to a client.
 */
export async function getFinancialSummary(): Promise<FinancialSummary> {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      jobNumber: true,
      title: true,
      jobType: true,
      contractAmount: true,
      balanceDue: true,
      laborCost: true,
      expenses: { select: { amount: true } },
      payments: { where: { status: "RECEIVED" }, select: { amount: true } },
    },
  });

  let totalContracted = 0;
  let totalCollected = 0;
  let totalOutstandingAR = 0;
  const profitability: JobProfitability[] = [];

  for (const j of jobs) {
    const contract = Number(j.contractAmount);
    const collected = j.payments.reduce((s, p) => s + Number(p.amount), 0);
    totalContracted += contract;
    totalCollected += collected;
    totalOutstandingAR += Number(j.balanceDue);

    if (j.jobType === "OWNED_REHAB") continue;
    const expensesTotal = j.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const cost = Number(j.laborCost ?? 0) + expensesTotal;
    const profit = contract - cost;
    profitability.push({
      jobId: j.id,
      jobNumber: j.jobNumber,
      title: j.title,
      jobType: j.jobType,
      revenue: contract,
      cost,
      profit,
      margin: contract > 0 ? profit / contract : 0,
    });
  }

  profitability.sort((a, b) => a.margin - b.margin); // worst margins first
  return {
    totalContracted,
    totalCollected,
    totalOutstandingAR,
    jobs: profitability,
  };
}
