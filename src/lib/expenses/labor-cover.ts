import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { recomputeCostPlusJob, recomputeJobBalance, rollsExpensesIntoContract } from "@/lib/services/job-pricing";
import {
  coveredNote,
  crewContractFor,
  crewPayeeHoldNote,
  isLaborCandidate,
  LABOR_TWIN_WINDOW_DAYS,
  laborTwinHoldNote,
  laborTwinsFor,
  type LaborContractRow,
  type LaborExpenseRow,
  type LaborPaymentRow,
} from "./labor-twins";

/**
 * Crew payments counted once. An expense that is the same money as a payment
 * on a crew's labor contract is REJECTED with `coveredByLaborPaymentId` set:
 * the labor payment carries the cost (the cost summary counts the whole
 * contract), and the bank row stays on file so cc-allocator's side still
 * reconciles. Every write here is audited and moves money exactly as an
 * approval or a delete would.
 */

const DAY = 86_400_000;

export const LABOR_CONTRACT_NAME_SELECT = {
  id: true,
  jobId: true,
  label: true,
  vendorId: true,
  crew: { select: { name: true, vendorId: true, vendor: { select: { name: true } } } },
  vendor: { select: { name: true } },
} as const;

type ContractWithNames = {
  id: string;
  jobId: string;
  label: string | null;
  vendorId: string | null;
  crew: { name: string; vendorId: string | null; vendor: { name: string } | null } | null;
  vendor: { name: string } | null;
};

export function toContractRow(c: ContractWithNames): LaborContractRow {
  const names = [c.crew?.name, c.label, c.vendor?.name, c.crew?.vendor?.name].filter((n): n is string => Boolean(n?.trim()));
  return { id: c.id, jobId: c.jobId, names: Array.from(new Set(names)), vendorId: c.vendorId ?? c.crew?.vendorId ?? null };
}

export const LABOR_EXPENSE_SELECT = {
  id: true, jobId: true, amount: true, incurredDate: true, vendor: true, description: true, vendorId: true,
  payrollPaymentId: true, status: true, coveredByLaborPaymentId: true, laborClearedAt: true,
} as const;

export function toExpenseRow<T extends { amount: { toString(): string } | number }>(e: T): Omit<T, "amount"> & { amount: number } {
  return { ...e, amount: Number(e.amount) };
}

/** A job's labor contracts and their payments near a date (all of them when no date). */
export async function loadJobLabor(jobId: string, near?: Date): Promise<{ contracts: LaborContractRow[]; payments: LaborPaymentRow[] }> {
  const window = (LABOR_TWIN_WINDOW_DAYS + 1) * DAY;
  const contracts = await prisma.laborContract.findMany({ where: { jobId }, select: LABOR_CONTRACT_NAME_SELECT });
  if (!contracts.length) return { contracts: [], payments: [] };
  const payments = await prisma.laborPayment.findMany({
    where: {
      laborContractId: { in: contracts.map((c) => c.id) },
      ...(near ? { paidDate: { gte: new Date(near.getTime() - window), lte: new Date(near.getTime() + window) } } : {}),
    },
    select: { id: true, laborContractId: true, amount: true, paidDate: true },
  });
  return { contracts: contracts.map(toContractRow), payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })) };
}

/**
 * Why an incoming posting should wait for a person, or null. Used by the
 * cc-allocator intake: a twin of a recorded crew payment, else a payment to a
 * crew that has a labor contract on the job.
 */
export async function laborHoldNote(input: { jobId: string; amount: number; incurredDate: Date; vendor: string | null; description: string | null; vendorId: string | null }): Promise<string | null> {
  if (input.amount <= 0) return null;
  const { contracts, payments } = await loadJobLabor(input.jobId, input.incurredDate);
  if (!contracts.length) return null;
  const covering = new Set(
    (await prisma.jobExpense.findMany({ where: { coveredByLaborPaymentId: { in: payments.map((p) => p.id) } }, select: { coveredByLaborPaymentId: true } }))
      .map((r) => r.coveredByLaborPaymentId as string),
  );
  const twin = laborTwinsFor(input, payments.filter((p) => !covering.has(p.id)), contracts)[0];
  if (twin) return laborTwinHoldNote(twin);
  const crew = crewContractFor(input, contracts);
  return crew ? crewPayeeHoldNote(crew) : null;
}

/** Expenses on the job that may be the same money as this new labor payment. */
export async function expensesTwinningPayment(paymentId: string) {
  const payment = await prisma.laborPayment.findUnique({ where: { id: paymentId }, select: { id: true, laborContractId: true, amount: true, paidDate: true, laborContract: { select: LABOR_CONTRACT_NAME_SELECT } } });
  if (!payment) return [];
  const contract = toContractRow(payment.laborContract);
  const window = (LABOR_TWIN_WINDOW_DAYS + 1) * DAY;
  const rows = await prisma.jobExpense.findMany({
    where: { jobId: contract.jobId, status: { not: "REJECTED" }, coveredByLaborPaymentId: null, laborClearedAt: null, payrollPaymentId: null, incurredDate: { gte: new Date(payment.paidDate.getTime() - window), lte: new Date(payment.paidDate.getTime() + window) } },
    select: { ...LABOR_EXPENSE_SELECT, externalId: true },
    orderBy: { incurredDate: "asc" },
  });
  const p: LaborPaymentRow = { id: payment.id, laborContractId: payment.laborContractId, amount: Number(payment.amount), paidDate: payment.paidDate };
  return rows
    .map(toExpenseRow)
    .filter((e) => isLaborCandidate(e) && laborTwinsFor(e, [p], [contract]).length > 0)
    .map((e) => ({ id: e.id, amount: e.amount, incurredDate: e.incurredDate.toISOString().slice(0, 10), vendor: e.vendor, status: e.status, fromBank: Boolean(e.externalId), difference: Math.round((e.amount - p.amount) * 100) / 100 }));
}

export type CoverResult = { ok: true; expenseId: string; laborPaymentId: string } | { ok: false; status: 400 | 404 | 409; error: string };

type ExpenseForCover = LaborExpenseRow & { billable: boolean; externalId: string | null; job: { jobType: "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB" } };

async function loadExpense(id: string): Promise<ExpenseForCover | null> {
  const e = await prisma.jobExpense.findUnique({ where: { id }, select: { ...LABOR_EXPENSE_SELECT, billable: true, externalId: true, job: { select: { jobType: true } } } });
  return e ? toExpenseRow(e) : null;
}

/** Take a counted (or waiting) expense out of the job's money: it is a crew payment's twin. */
async function rejectAsCovered(e: ExpenseForCover, laborPaymentId: string, note: string, actorUserId: string, how: "same_money" | "recorded_as_payment") {
  const isRollup = rollsExpensesIntoContract(e.job.jobType);
  const wasCounted = e.status === "APPROVED";
  const reverse = wasCounted && !isRollup && e.billable ? e.amount : 0;
  await prisma.$transaction([
    prisma.jobExpense.update({
      where: { id: e.id },
      data: { status: "REJECTED", coveredByLaborPaymentId: laborPaymentId, approvedByUserId: actorUserId, approvedAt: new Date(), reviewNote: note },
    }),
    ...(reverse ? [prisma.job.update({ where: { id: e.jobId }, data: { contractAmount: { decrement: reverse } } })] : []),
  ]);
  if (isRollup && wasCounted) await recomputeCostPlusJob(e.jobId);
  else if (reverse) await recomputeJobBalance(e.jobId);
  await recordAudit({
    actorUserId,
    entityType: "JobExpense",
    entityId: e.id,
    action: "expense_covered_by_labor_payment",
    before: { status: e.status, amount: e.amount, jobId: e.jobId, billable: e.billable, externalId: e.externalId },
    after: { status: "REJECTED", laborPaymentId, how, reversedContractBy: reverse, note },
  });
}

function refuse(e: ExpenseForCover | null): CoverResult | null {
  if (!e) return { ok: false, status: 404, error: "Expense not found" };
  if (e.coveredByLaborPaymentId) return { ok: false, status: 409, error: "This charge is already counted through a crew payment" };
  if (e.status === "REJECTED") return { ok: false, status: 409, error: "This charge is rejected; it is not counted" };
  if (e.payrollPaymentId) return { ok: false, status: 400, error: "A payroll posting is not a crew contract payment" };
  if (e.amount <= 0) return { ok: false, status: 400, error: "A credit is not a crew payment" };
  return null;
}

/** "Same money": the expense duplicates a payment already on the crew's labor contract. */
export async function coverWithLaborPayment(expenseId: string, laborPaymentId: string, actorUserId: string): Promise<CoverResult> {
  const e = await loadExpense(expenseId);
  const bad = refuse(e);
  if (bad) return bad;
  const payment = await prisma.laborPayment.findUnique({ where: { id: laborPaymentId }, select: { id: true, amount: true, paidDate: true, laborContract: { select: LABOR_CONTRACT_NAME_SELECT } } });
  if (!payment) return { ok: false, status: 404, error: "Labor payment not found" };
  if (payment.laborContract.jobId !== e!.jobId) return { ok: false, status: 400, error: "The labor payment is on a different job" };
  const taken = await prisma.jobExpense.findFirst({ where: { coveredByLaborPaymentId: payment.id }, select: { id: true } });
  if (taken) return { ok: false, status: 409, error: "That labor payment already accounts for another bank charge" };
  const note = coveredNote({ amount: Number(payment.amount), paidDate: payment.paidDate }, toContractRow(payment.laborContract), e!.amount);
  await rejectAsCovered(e!, payment.id, note, actorUserId, "same_money");
  return { ok: true, expenseId: e!.id, laborPaymentId: payment.id };
}

/** "Record on the contract": the expense is a crew payment nobody recorded — record it there, count it once. */
export async function recordAsLaborPayment(expenseId: string, laborContractId: string, actorUserId: string): Promise<CoverResult> {
  const e = await loadExpense(expenseId);
  const bad = refuse(e);
  if (bad) return bad;
  const contract = await prisma.laborContract.findUnique({ where: { id: laborContractId }, select: { ...LABOR_CONTRACT_NAME_SELECT, job: { select: { leadId: true } } } });
  if (!contract) return { ok: false, status: 404, error: "Labor contract not found" };
  if (contract.jobId !== e!.jobId) return { ok: false, status: 400, error: "The labor contract is on a different job" };
  const full = await prisma.jobExpense.findUnique({ where: { id: e!.id }, select: { paidMethod: true } });
  const payment = await prisma.laborPayment.create({
    data: {
      laborContractId: contract.id,
      amount: e!.amount,
      paidDate: e!.incurredDate,
      method: full?.paidMethod ?? null,
      reference: e!.externalId ? "Bank posting" : "Job expense",
      notes: `Recorded from the ${e!.externalId ? "bank posting" : "expense"} ${e!.incurredDate.toISOString().slice(0, 10)}: ${(e!.vendor ?? "").slice(0, 120)}`,
      createdByUserId: actorUserId,
    },
  });
  const name = toContractRow(contract).names[0] ?? "Labor";
  await prisma.activityLog.create({ data: { leadId: contract.job.leadId, activityType: "NOTE", title: `Labor payment to ${name}: $${e!.amount.toLocaleString()} (from a bank posting)`, createdByUserId: actorUserId } });
  await recordAudit({ actorUserId, entityType: "LaborPayment", entityId: payment.id, action: "create", after: { laborContractId: contract.id, amount: e!.amount, fromExpenseId: e!.id } });
  const note = `Recorded as a payment of $${e!.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} to ${name} on its labor contract — counted there, not here.`;
  await rejectAsCovered(e!, payment.id, note, actorUserId, "recorded_as_payment");
  return { ok: true, expenseId: e!.id, laborPaymentId: payment.id };
}

/**
 * "A cost of its own": a person checked and it is not a crew payment counted
 * twice. The row stops being offered; a row held at intake for this reason is
 * approved, moving money as an approval does.
 */
export async function clearLaborCheck(expenseId: string, actorUserId: string, note?: string | null): Promise<{ ok: true; approved: boolean } | { ok: false; status: 404 | 409; error: string }> {
  const e = await loadExpense(expenseId);
  if (!e) return { ok: false, status: 404, error: "Expense not found" };
  if (e.coveredByLaborPaymentId || e.status === "REJECTED") return { ok: false, status: 409, error: "This charge is not counted; there is nothing to keep" };
  const approving = e.status === "PENDING";
  const isRollup = rollsExpensesIntoContract(e.job.jobType);
  const increment = approving && !isRollup && e.billable ? e.amount : 0;
  await prisma.$transaction([
    prisma.jobExpense.update({
      where: { id: e.id },
      data: {
        laborClearedAt: new Date(),
        ...(approving ? { status: "APPROVED" as const, approvedByUserId: actorUserId, approvedAt: new Date(), reviewNote: note?.trim() || "Checked: a cost of its own, not a crew payment counted twice." } : {}),
      },
    }),
    ...(increment ? [prisma.job.update({ where: { id: e.jobId }, data: { contractAmount: { increment } } })] : []),
  ]);
  if (approving && isRollup) await recomputeCostPlusJob(e.jobId);
  else if (increment) await recomputeJobBalance(e.jobId);
  await recordAudit({ actorUserId, entityType: "JobExpense", entityId: e.id, action: "expense_labor_check_cleared", before: { status: e.status }, after: { status: approving ? "APPROVED" : e.status, movedContract: increment, note: note?.trim() || null } });
  return { ok: true, approved: approving };
}

/**
 * Before a labor payment (or its contract) is deleted: a charge it accounted
 * for would silently drop out of the job's cost, so it goes back to the
 * review queue instead.
 */
export async function releaseCoveredExpenses(laborPaymentIds: string[], actorUserId: string): Promise<number> {
  if (!laborPaymentIds.length) return 0;
  const rows = await prisma.jobExpense.findMany({ where: { coveredByLaborPaymentId: { in: laborPaymentIds } }, select: { id: true, coveredByLaborPaymentId: true } });
  for (const r of rows) {
    await prisma.jobExpense.update({
      where: { id: r.id },
      data: { status: "PENDING", coveredByLaborPaymentId: null, approvedByUserId: null, approvedAt: null, reviewNote: "The crew payment that accounted for this charge was deleted. Approve it if it is a real cost of this job." },
    });
    await recordAudit({ actorUserId, entityType: "JobExpense", entityId: r.id, action: "expense_cover_released", before: { status: "REJECTED", laborPaymentId: r.coveredByLaborPaymentId }, after: { status: "PENDING" } });
  }
  return rows.length;
}
