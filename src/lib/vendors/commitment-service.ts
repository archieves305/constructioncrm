import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { canMoveStatus, commitmentForExpense, openAmount, type CommitmentStatusName } from "./commitments";
import { complianceForVendors, summarise } from "./compliance-load";
import { VendorError } from "./service";

const num = (d: unknown) => Number(d ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: string | null | undefined) => v?.trim() || null;

/** Σ approved expenses drawn against each commitment. */
async function receivedBy(commitmentIds: readonly string[]): Promise<Map<string, number>> {
  if (commitmentIds.length === 0) return new Map();
  const rows = await prisma.jobExpense.groupBy({
    by: ["commitmentId"],
    where: { commitmentId: { in: [...commitmentIds] }, status: "APPROVED" },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.commitmentId as string, num(r._sum.amount)]));
}

/**
 * Each job's open commitments, less what has been drawn — the figure that
 * joins "committed" in the cost summary. One definition for every reader.
 */
export async function openCommitmentsByJob(jobWhere: Prisma.CommitmentWhereInput = {}): Promise<Map<string, number>> {
  const open = await prisma.commitment.findMany({ where: { ...jobWhere, status: "OPEN" }, select: { id: true, jobId: true, amount: true, status: true } });
  const received = await receivedBy(open.map((c) => c.id));
  const out = new Map<string, number>();
  for (const c of open) {
    out.set(c.jobId, (out.get(c.jobId) ?? 0) + openAmount({ status: c.status, amount: num(c.amount) }, received.get(c.id) ?? 0));
  }
  return out;
}

/** The commitment a new expense draws down without anyone picking, or null. Never throws. */
export async function autoCommitmentId(jobId: string, vendorId: string | null): Promise<string | null> {
  if (!vendorId) return null;
  try {
    const open = await prisma.commitment.findMany({ where: { jobId, vendorId, status: "OPEN" }, select: { id: true, vendorId: true } });
    return commitmentForExpense(vendorId, open);
  } catch {
    return null;
  }
}

const COMMITMENT_SELECT = {
  id: true,
  jobId: true,
  number: true,
  description: true,
  amount: true,
  status: true,
  committedDate: true,
  closedAt: true,
  notes: true,
  createdAt: true,
  vendor: { select: { id: true, name: true, kind: true } },
  budgetLine: { select: { id: true, name: true, category: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { expenses: true } },
} as const;

type Row = Prisma.CommitmentGetPayload<{ select: typeof COMMITMENT_SELECT }>;

function view(c: Row, received: number) {
  const amount = num(c.amount);
  return { ...c, amount, received, open: openAmount({ status: c.status, amount }, received), expenseCount: c._count.expenses, _count: undefined };
}

/** A job's commitments, with what each has received and what is still open, plus its labor contracts as read-only rows. */
export async function listJobCommitments(jobId: string) {
  const [commitments, contracts, budgetLines] = await Promise.all([
    prisma.commitment.findMany({ where: { jobId }, orderBy: { number: "asc" }, select: COMMITMENT_SELECT }),
    prisma.laborContract.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, label: true, contractAmount: true,
        vendor: { select: { id: true, name: true } },
        crew: { select: { name: true, vendor: { select: { id: true, name: true } } } },
        payments: { select: { amount: true } },
        changeOrders: { select: { amount: true } },
      },
    }),
    prisma.budgetLine.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, category: true } }),
  ]);
  const received = await receivedBy(commitments.map((c) => c.id));
  const compliance = await complianceForVendors(commitments.map((c) => c.vendor.id));
  const rows = commitments.map((c) => ({ ...view(c, received.get(c.id) ?? 0), vendorCompliance: summarise(compliance.get(c.vendor.id)) }));
  const labor = contracts.map((c) => {
    const amount = num(c.contractAmount) + c.changeOrders.reduce((s, o) => s + num(o.amount), 0);
    const paid = c.payments.reduce((s, p) => s + num(p.amount), 0);
    return { id: c.id, name: c.crew?.name ?? c.label ?? "Labor", vendor: c.vendor ?? c.crew?.vendor ?? null, amount, paid, open: Math.max(0, Math.round((amount - paid) * 100) / 100) };
  });
  return {
    commitments: rows,
    laborContracts: labor,
    budgetLines,
    // Open commitments only, so the three figures add up: a closed or
    // cancelled one promises nothing more.
    totals: {
      committed: round2(rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + r.amount, 0)),
      received: round2(rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + r.received, 0)),
      open: round2(rows.reduce((s, r) => s + r.open, 0)),
    },
  };
}

export type CommitmentInput = {
  vendorId: string;
  description: string;
  amount: number;
  budgetLineId?: string | null;
  /** "yyyy-MM-dd"; defaults to today. */
  committedDate?: string | null;
  notes?: string | null;
};

async function assertLinks(jobId: string, vendorId: string | undefined, budgetLineId: string | null | undefined) {
  if (vendorId !== undefined) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!vendor) throw new VendorError(400, "Choose a vendor");
  }
  if (budgetLineId) {
    const line = await prisma.budgetLine.findFirst({ where: { id: budgetLineId, jobId }, select: { id: true } });
    if (!line) throw new VendorError(400, "That budget line is not on this job");
  }
}

const parseDay = (v: string | null | undefined): Date | undefined => {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new VendorError(400, "The date must be a day");
  return new Date(`${v}T12:00:00.000Z`);
};

export async function createCommitment(jobId: string, input: CommitmentInput, actorUserId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, leadId: true } });
  if (!job) throw new VendorError(404, "Job not found");
  await assertLinks(jobId, input.vendorId, input.budgetLineId);
  const committedDate = parseDay(input.committedDate);

  // The number is per job; the unique index is the backstop if two people add at once.
  for (let attempt = 0; ; attempt += 1) {
    const last = await prisma.commitment.aggregate({ where: { jobId }, _max: { number: true } });
    try {
      const created = await prisma.commitment.create({
        data: {
          jobId,
          vendorId: input.vendorId,
          number: (last._max.number ?? 0) + 1,
          description: input.description.trim(),
          amount: input.amount,
          budgetLineId: input.budgetLineId || null,
          notes: clean(input.notes),
          createdByUserId: actorUserId,
          ...(committedDate ? { committedDate } : {}),
        },
        select: COMMITMENT_SELECT,
      });
      await recordAudit({ actorUserId, entityType: "Commitment", entityId: created.id, action: "create", after: { jobId, vendorId: input.vendorId, number: created.number, amount: input.amount } });
      await prisma.activityLog.create({
        data: { leadId: job.leadId, activityType: "NOTE", title: `Commitment C-${created.number} added: ${created.vendor.name} — $${input.amount.toLocaleString()}`, description: created.description, createdByUserId: actorUserId },
      });
      return view(created, 0);
    } catch (err) {
      const unique = typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
      if (!unique || attempt >= 3) throw err;
    }
  }
}

export type CommitmentUpdate = Partial<CommitmentInput> & { status?: CommitmentStatusName };

export async function updateCommitment(id: string, input: CommitmentUpdate, actorUserId: string) {
  const before = await prisma.commitment.findUnique({ where: { id } });
  if (!before) throw new VendorError(404, "Commitment not found");
  await assertLinks(before.jobId, input.vendorId, input.budgetLineId);

  const data: Prisma.CommitmentUncheckedUpdateInput = {};
  if (input.vendorId !== undefined && input.vendorId !== before.vendorId) {
    const linked = await prisma.jobExpense.count({ where: { commitmentId: id } });
    if (linked > 0) throw new VendorError(409, "Expenses are already linked to this commitment, so its vendor cannot change. Cancel it and add a new one.");
    data.vendorId = input.vendorId;
  }
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.budgetLineId !== undefined) data.budgetLineId = input.budgetLineId || null;
  if (input.notes !== undefined) data.notes = clean(input.notes);
  const day = parseDay(input.committedDate);
  if (day) data.committedDate = day;
  if (input.status !== undefined && input.status !== before.status) {
    if (!canMoveStatus(before.status, input.status)) throw new VendorError(409, "A cancelled commitment cannot be closed. Reopen it first.");
    data.status = input.status;
    data.closedAt = input.status === "OPEN" ? null : new Date();
  }

  const updated = await prisma.commitment.update({ where: { id }, data, select: COMMITMENT_SELECT });
  await recordAudit({
    actorUserId,
    entityType: "Commitment",
    entityId: id,
    action: input.status !== undefined && input.status !== before.status ? "status_change" : "update",
    before: { amount: num(before.amount), status: before.status, vendorId: before.vendorId, budgetLineId: before.budgetLineId },
    after: { amount: updated.amount, status: updated.status, vendorId: updated.vendor.id, budgetLineId: updated.budgetLine?.id ?? null },
  });
  const received = await receivedBy([id]);
  return view(updated, received.get(id) ?? 0);
}

/** Only a commitment nothing has been charged against may be deleted; otherwise cancel it. */
export async function deleteCommitment(id: string, actorUserId: string): Promise<{ jobId: string }> {
  const c = await prisma.commitment.findUnique({ where: { id }, select: { id: true, jobId: true, number: true, amount: true, vendorId: true, _count: { select: { expenses: true } } } });
  if (!c) throw new VendorError(404, "Commitment not found");
  if (c._count.expenses > 0) throw new VendorError(409, "Expenses are linked to this commitment. Cancel it instead of deleting it.");
  await prisma.commitment.delete({ where: { id } });
  await recordAudit({ actorUserId, entityType: "Commitment", entityId: id, action: "delete", before: { jobId: c.jobId, number: c.number, amount: num(c.amount), vendorId: c.vendorId } });
  return { jobId: c.jobId };
}

/** A vendor's commitments across jobs, for its page. */
export async function listVendorCommitments(vendorId: string) {
  const commitments = await prisma.commitment.findMany({
    where: { vendorId },
    orderBy: [{ status: "asc" }, { committedDate: "desc" }],
    select: { ...COMMITMENT_SELECT, job: { select: JOB_LABEL_SELECT } },
  });
  const received = await receivedBy(commitments.map((c) => c.id));
  return commitments.map((c) => ({ ...view(c, received.get(c.id) ?? 0), job: c.job }));
}
