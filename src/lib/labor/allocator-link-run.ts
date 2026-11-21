import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { LABOR_CONTRACT_NAME_SELECT, toContractRow } from "@/lib/expenses/labor-cover";
import { settleRequestOnPayment } from "@/lib/labor/payment-requests";
import { formatAddressLine } from "@/lib/labels";
import { CC_ALLOCATOR_SYSTEM_USER_ID } from "@/lib/integrations/cc-allocator/system-user";
import {
  crewPaymentCandidates,
  linkProblem,
  openRequestFor,
  soleCandidate,
  type AllocatorLine,
  type CrewPaymentRow,
} from "./allocator-link";

/**
 * The database side of "crew payments, one posting" (see allocator-link.ts):
 * what CC Allocator asks before it sends a crew payment line, and what the
 * intake does when it arrives.
 */

const DAY = 86_400_000;

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paidDate: true,
  method: true,
  paidFromKey: true,
  paidFromLabel: true,
  allocatorExternalId: true,
  laborContract: { select: { ...LABOR_CONTRACT_NAME_SELECT, job: { select: { jobNumber: true, lead: { select: { propertyAddress1: true, city: true } } } } } },
  _count: { select: { coveredExpenses: true } },
} as const;

type PaymentWithContract = {
  id: string;
  amount: { toString(): string };
  paidDate: Date;
  method: string | null;
  paidFromKey: string | null;
  paidFromLabel: string | null;
  allocatorExternalId: string | null;
  laborContract: Parameters<typeof toContractRow>[0] & { job: { jobNumber: string; lead: { propertyAddress1: string | null; city: string | null } } };
  _count: { coveredExpenses: number };
};

function toRow(p: PaymentWithContract): CrewPaymentRow {
  const c = toContractRow(p.laborContract);
  return {
    id: p.id,
    jobId: c.jobId,
    amount: Number(p.amount),
    paidDate: p.paidDate,
    paidFromKey: p.paidFromKey,
    names: c.names,
    linked: Boolean(p.allocatorExternalId),
    covered: p._count.coveredExpenses > 0,
  };
}

function describe(p: PaymentWithContract) {
  const c = toContractRow(p.laborContract);
  return {
    laborPaymentId: p.id,
    laborContractId: c.id,
    jobId: c.jobId,
    jobNumber: p.laborContract.job.jobNumber,
    address: formatAddressLine({ propertyAddress1: p.laborContract.job.lead.propertyAddress1, city: p.laborContract.job.lead.city }),
    crew: c.names[0] ?? "Labor",
    amount: Number(p.amount),
    paidDate: p.paidDate.toISOString(),
    method: p.method,
    paidFromKey: p.paidFromKey,
    paidFromLabel: p.paidFromLabel,
  };
}

/** Crew payments recorded in the CRM that a bank or card line may be (any job). */
export async function crewPaymentMatches(line: AllocatorLine) {
  const window = 4 * DAY;
  const rows = (await prisma.laborPayment.findMany({
    where: { allocatorExternalId: null, paidDate: { gte: new Date(line.date.getTime() - window), lte: new Date(line.date.getTime() + window) } },
    select: PAYMENT_SELECT,
  })) as PaymentWithContract[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates = crewPaymentCandidates(line, rows.map(toRow));
  const sole = soleCandidate(candidates);
  return {
    candidates: candidates.map((c) => ({ ...describe(byId.get(c.id)!), exactAmount: c.exactAmount, sameAccount: c.sameAccount, payeeMatch: c.payeeMatch, days: c.days })),
    prefill: sole?.id ?? null,
  };
}

/** A job's crews: each labor contract with what is paid, open payment requests and crew payments not yet linked to a line. */
export async function jobCrewSummary(jobId: string) {
  const contracts = await prisma.laborContract.findMany({
    where: { jobId },
    select: {
      ...LABOR_CONTRACT_NAME_SELECT,
      contractAmount: true,
      payments: { select: { amount: true } },
      paymentRequests: { where: { status: "REQUESTED" }, select: { id: true, amount: true, neededBy: true, note: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const unlinked = (await prisma.laborPayment.findMany({
    where: { allocatorExternalId: null, laborContract: { jobId }, coveredExpenses: { none: {} } },
    select: PAYMENT_SELECT,
    orderBy: { paidDate: "desc" },
    take: 50,
  })) as PaymentWithContract[];
  return {
    contracts: contracts.map((c) => {
      const paid = c.payments.reduce((s, p) => s + Number(p.amount), 0);
      return {
        laborContractId: c.id,
        crew: toContractRow(c).names[0] ?? "Labor",
        names: toContractRow(c).names,
        contractAmount: Number(c.contractAmount),
        paid,
        openRequests: c.paymentRequests.map((r) => ({ requestId: r.id, amount: Number(r.amount), neededBy: r.neededBy?.toISOString() ?? null, note: r.note })),
      };
    }),
    unlinkedPayments: unlinked.map(describe),
  };
}

export type CrewLineInput = {
  externalId: string;
  jobId: string;
  amount: number;
  incurredDate: Date;
  paidMethod: string | null;
  paidFrom: string | null;
  vendor: string | null;
  laborPaymentId?: string | null;
  laborContractId?: string | null;
  requestId?: string | null;
};

export type CrewLineResult =
  | { ok: true; laborPaymentId: string; created: boolean; alreadyExists: boolean; requestSettled: string | null }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** A line CC Allocator already sent as a crew payment (idempotent replay). */
export async function crewPaymentForExternalId(externalId: string) {
  return prisma.laborPayment.findUnique({ where: { allocatorExternalId: externalId }, select: { id: true, laborContract: { select: { jobId: true } } } });
}

/**
 * The intake's crew mode. With `laborPaymentId` the line is linked to a crew
 * payment already recorded in the CRM; with `laborContractId` a crew payment
 * is created from the line (and its open payment request settled). Never a
 * job expense: the labor contract already counts the cost.
 */
export async function takeCrewPaymentLine(input: CrewLineInput): Promise<CrewLineResult> {
  const replay = await crewPaymentForExternalId(input.externalId);
  if (replay) {
    if (replay.laborContract.jobId !== input.jobId) return { ok: false, status: 409, error: "This line is already linked to a crew payment on a different job" };
    return { ok: true, laborPaymentId: replay.id, created: false, alreadyExists: true, requestSettled: null };
  }
  if (input.amount <= 0) return { ok: false, status: 400, error: "A crew payment line must be money out" };

  if (input.laborPaymentId) {
    const p = await prisma.laborPayment.findUnique({
      where: { id: input.laborPaymentId },
      select: { id: true, method: true, paidFromLabel: true, allocatorExternalId: true, laborContract: { select: { jobId: true } }, _count: { select: { coveredExpenses: true } } },
    });
    const problem = linkProblem(p ? { jobId: p.laborContract.jobId, allocatorExternalId: p.allocatorExternalId, covered: p._count.coveredExpenses > 0 } : null, input);
    if (problem) return { ok: false, ...problem };
    // Conditional on still being unlinked: a second line racing for the same payment loses.
    const set = await prisma.laborPayment.updateMany({
      where: { id: p!.id, allocatorExternalId: null },
      data: {
        allocatorExternalId: input.externalId,
        allocatorLinkedAt: new Date(),
        allocatorLineDate: input.incurredDate,
        allocatorLineAmount: input.amount,
        ...(p!.paidFromLabel ? {} : { paidFromLabel: input.paidFrom?.slice(0, 120) || null }),
        ...(p!.method ? {} : { method: (input.paidMethod as never) ?? null }),
      },
    });
    if (set.count === 0) return { ok: false, status: 409, error: "That crew payment was just linked to another line" };
    await recordAudit({ actorUserId: CC_ALLOCATOR_SYSTEM_USER_ID, entityType: "LaborPayment", entityId: p!.id, action: "allocator_line_linked", after: { externalId: input.externalId, amount: input.amount, date: input.incurredDate.toISOString() } });
    return { ok: true, laborPaymentId: p!.id, created: false, alreadyExists: false, requestSettled: null };
  }

  if (!input.laborContractId) return { ok: false, status: 400, error: "laborPaymentId or laborContractId is required" };
  const contract = await prisma.laborContract.findUnique({
    where: { id: input.laborContractId },
    select: { ...LABOR_CONTRACT_NAME_SELECT, job: { select: { leadId: true } }, paymentRequests: { where: { status: "REQUESTED" }, select: { id: true, amount: true, status: true } } },
  });
  if (!contract) return { ok: false, status: 404, error: "Labor contract not found" };
  if (contract.jobId !== input.jobId) return { ok: false, status: 409, error: "That labor contract is on a different job" };
  const requestId = input.requestId
    ? contract.paymentRequests.some((r) => r.id === input.requestId) ? input.requestId : null
    : openRequestFor(input.amount, contract.paymentRequests.map((r) => ({ id: r.id, amount: Number(r.amount), status: r.status })));

  let payment: { id: string };
  try {
    payment = await prisma.laborPayment.create({
      data: {
        laborContractId: contract.id,
        amount: input.amount,
        paidDate: input.incurredDate,
        method: (input.paidMethod as never) ?? null,
        reference: input.paidMethod === "CARD" ? "Card line" : "Bank line",
        notes: `From CC Allocator: ${(input.vendor ?? "").slice(0, 160)}`,
        paidFromLabel: input.paidFrom?.slice(0, 120) || null,
        allocatorExternalId: input.externalId,
        allocatorLinkedAt: new Date(),
        allocatorLineDate: input.incurredDate,
        allocatorLineAmount: input.amount,
        createdByUserId: CC_ALLOCATOR_SYSTEM_USER_ID,
      },
      select: { id: true },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const won = await crewPaymentForExternalId(input.externalId);
      if (won) return { ok: true, laborPaymentId: won.id, created: false, alreadyExists: true, requestSettled: null };
    }
    throw e;
  }
  const name = toContractRow(contract).names[0] ?? "Labor";
  await prisma.activityLog.create({ data: { leadId: contract.job.leadId, activityType: "NOTE", title: `Labor payment to ${name}: $${input.amount.toLocaleString()} (from CC Allocator)`, createdByUserId: CC_ALLOCATOR_SYSTEM_USER_ID } });
  await recordAudit({ actorUserId: CC_ALLOCATOR_SYSTEM_USER_ID, entityType: "LaborPayment", entityId: payment.id, action: "create", after: { laborContractId: contract.id, amount: input.amount, externalId: input.externalId, requestId } });
  if (requestId) await settleRequestOnPayment(requestId, payment.id, CC_ALLOCATOR_SYSTEM_USER_ID);
  return { ok: true, laborPaymentId: payment.id, created: true, alreadyExists: false, requestSettled: requestId };
}
