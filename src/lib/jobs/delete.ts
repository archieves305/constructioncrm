import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";

/**
 * Deleting a job is for jobs created by mistake or as a test. A job that
 * carries real business records — money that moved, bills, field logs, a
 * contract a customer has seen, a violation case — is refused: those records
 * are removed (or the job closed) by their own audited paths, never swept
 * away with the job.
 */
export type JobDeleteCounts = {
  payments: number;
  expenses: number;
  invoices: number;
  laborPayments: number;
  dailyLogs: number;
  laborEntries: number;
  contractsIssued: number;
  violationCases: number;
  tasks: number;
  permits: number;
  laborContracts: number;
  changeOrders: number;
  commitments: number;
  budgetLines: number;
  files: number;
};

export type JobDeleteLine = { label: string; count: number };

const BLOCKING: readonly [keyof JobDeleteCounts, string][] = [
  ["payments", "customer payments"],
  ["expenses", "expenses"],
  ["invoices", "invoices or payment applications"],
  ["laborPayments", "payments to crews"],
  ["dailyLogs", "daily logs"],
  ["laborEntries", "field labor entries"],
  ["contractsIssued", "customer contracts sent or signed"],
  ["violationCases", "code-violation cases linked to this job"],
];

const REMOVED: readonly [keyof JobDeleteCounts, string][] = [
  ["tasks", "tasks and workflow steps"],
  ["permits", "permits"],
  ["laborContracts", "labor contracts (none paid)"],
  ["changeOrders", "change orders"],
  ["commitments", "commitments"],
  ["budgetLines", "budget lines"],
];

const lines = (spec: readonly [keyof JobDeleteCounts, string][], counts: JobDeleteCounts): JobDeleteLine[] =>
  spec.filter(([k]) => counts[k] > 0).map(([k, label]) => ({ label, count: counts[k] }));

/** Records that stop the delete. Empty = the job may be deleted. */
export function jobDeleteBlockers(counts: JobDeleteCounts): JobDeleteLine[] {
  return lines(BLOCKING, counts);
}

/** What goes with the job, and what stays behind, for the confirmation. */
export function jobDeletePlan(counts: JobDeleteCounts) {
  return {
    blockers: jobDeleteBlockers(counts),
    removes: lines(REMOVED, counts),
    // Files are never deleted with a job: they stay on the lead.
    keptFiles: counts.files,
  };
}

export async function loadJobDeleteCounts(jobId: string): Promise<JobDeleteCounts> {
  const [
    payments, expenses, invoices, laborPayments, dailyLogs, laborEntries, contractsIssued, violationCases,
    tasks, permits, laborContracts, changeOrders, commitments, budgetLines, files,
  ] = await Promise.all([
    prisma.payment.count({ where: { jobId } }),
    prisma.jobExpense.count({ where: { jobId } }),
    prisma.invoice.count({ where: { jobId } }),
    prisma.laborPayment.count({ where: { laborContract: { jobId } } }),
    prisma.dailyLog.count({ where: { jobId } }),
    prisma.dailyLaborEntry.count({ where: { jobId } }),
    prisma.customerContract.count({ where: { jobId, status: { in: ["SENT", "SIGNED"] } } }),
    prisma.codeViolationCase.count({ where: { jobId } }),
    prisma.task.count({ where: { jobId } }),
    prisma.jobPermit.count({ where: { jobId } }),
    prisma.laborContract.count({ where: { jobId } }),
    prisma.changeOrder.count({ where: { jobId } }),
    prisma.commitment.count({ where: { jobId } }),
    prisma.budgetLine.count({ where: { jobId } }),
    prisma.file.count({ where: { jobId } }),
  ]);
  return {
    payments, expenses, invoices, laborPayments, dailyLogs, laborEntries, contractsIssued, violationCases,
    tasks, permits, laborContracts, changeOrders, commitments, budgetLines, files,
  };
}

export type DeleteJobResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "blocked"; blockers: JobDeleteLine[] };

/**
 * The one way a job is deleted. Tasks go first (their link to a job is
 * SET NULL, so they would otherwise be left with no subject); everything else
 * follows the job by cascade. The lead and its files stay. Audited with a
 * snapshot of the job and what went with it.
 */
export async function deleteJob(jobId: string, actor: { userId: string; reason: string }): Promise<DeleteJobResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true, jobNumber: true, title: true, leadId: true, jobType: true, contractAmount: true,
      createdAt: true, currentStage: { select: { name: true } },
    },
  });
  if (!job) return { ok: false, reason: "not_found" };

  const counts = await loadJobDeleteCounts(jobId);
  const blockers = jobDeleteBlockers(counts);
  if (blockers.length > 0) return { ok: false, reason: "blocked", blockers };

  await prisma.$transaction([
    prisma.task.deleteMany({ where: { jobId } }),
    prisma.job.delete({ where: { id: jobId } }),
  ]);

  await recordAudit({
    actorUserId: actor.userId,
    entityType: "Job",
    entityId: job.id,
    action: "job_delete",
    before: {
      jobNumber: job.jobNumber,
      title: job.title,
      leadId: job.leadId,
      jobType: job.jobType,
      stage: job.currentStage.name,
      contractAmount: job.contractAmount == null ? null : Number(job.contractAmount),
      createdAt: job.createdAt,
      removed: counts,
    },
    after: { reason: actor.reason },
  });

  return { ok: true };
}
