import type { TaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { formatAddressLine } from "@/lib/labels/address";
import { logger } from "@/lib/logger";
import { createTask } from "@/lib/tasks/create";
import { updateTask } from "@/lib/tasks/update";
import { userForJobRole } from "@/lib/workflows/roles";

/**
 * "Please pay this crew $X."
 *
 * Raised from a labor contract. The request is carried by an ordinary CRM
 * task — assigned to whoever was picked, otherwise the job's accountant — so
 * the person gets the usual assignment email and it sits in their tasks.
 * Recording the payment against the request closes both. A `LaborPayment`
 * still means "paid"; this row is the ask.
 */
export class PaymentRequestError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = "PaymentRequestError";
  }
}

export const requestSourceKey = (requestId: string) => `labor-payment-request:${requestId}`;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export const REQUEST_INCLUDE = {
  requestedBy: PERSON,
  task: { select: { id: true, status: true, assignedTo: PERSON } },
  laborPayment: { select: { id: true, amount: true, paidDate: true } },
  lines: { select: { id: true, name: true } },
} as const;

/** `neededBy` is a day: a bare yyyy-MM-dd pinned to noon UTC so it stays on its day in every zone. */
function dayAtNoon(day: string | null | undefined, fallback: Date): Date {
  return day ? new Date(`${day.slice(0, 10)}T12:00:00.000Z`) : fallback;
}

export async function createPaymentRequest(input: {
  contractId: string;
  amount: number;
  note?: string | null;
  /** yyyy-MM-dd */
  neededBy?: string | null;
  /** Leave empty for the job's accountant. */
  assignedUserId?: string | null;
  /** Schedule lines this payment covers. */
  lineIds?: string[];
  actorUserId: string;
}) {
  const contract = await prisma.laborContract.findUnique({
    where: { id: input.contractId },
    select: {
      id: true,
      jobId: true,
      label: true,
      contractAmount: true,
      crew: { select: { name: true } },
      changeOrders: { select: { amount: true } },
      payments: { select: { amount: true } },
      job: { select: { lead: { select: { propertyAddress1: true, propertyAddress2: true, city: true } } } },
    },
  });
  if (!contract) throw new PaymentRequestError(404, "Labor contract not found");

  const lines = input.lineIds?.length
    ? await prisma.laborContractTask.findMany({ where: { id: { in: input.lineIds }, laborContractId: contract.id }, select: { id: true, name: true, paymentRequestId: true } })
    : [];
  const taken = lines.filter((l) => l.paymentRequestId);
  if (taken.length > 0) throw new PaymentRequestError(409, `Already requested: ${taken.map((l) => l.name).join(", ")}`);

  const assignee = input.assignedUserId || (await userForJobRole(contract.jobId, "ACCOUNTING"));
  if (!assignee) {
    throw new PaymentRequestError(400, "This job has no accountant. Pick who should pay it, or set the Accounting default under Admin → Workflow Roles.");
  }

  const crew = contract.crew?.name ?? contract.label ?? "the crew";
  const revised = Number(contract.contractAmount) + contract.changeOrders.reduce((s, c) => s + Number(c.amount), 0);
  const paid = contract.payments.reduce((s, p) => s + Number(p.amount), 0);
  const address = formatAddressLine(contract.job.lead);
  const today = new Date();

  const request = await prisma.laborPaymentRequest.create({
    data: {
      laborContractId: contract.id,
      amount: input.amount,
      note: input.note?.trim() || null,
      neededBy: input.neededBy ? dayAtNoon(input.neededBy, today) : null,
      requestedByUserId: input.actorUserId,
    },
  });

  try {
    const task = await createTask(
      {
        title: `Pay ${money(input.amount)} to ${crew}${address ? ` — ${address}` : ""}`,
        description: [
          input.note?.trim() || null,
          lines.length ? `For: ${lines.map((l) => l.name).join(", ")}.` : null,
          `Labor contract ${money(revised)} · paid so far ${money(paid)} · outstanding ${money(revised - paid)}.`,
          "Record the payment from the job's Field → Labor tab; this task closes itself when you do.",
        ].filter(Boolean).join("\n\n"),
        // A payment someone is waiting on: high priority and due on the day it is needed, so the email is not held for a digest.
        priority: "HIGH",
        dueAt: dayAtNoon(input.neededBy, new Date(`${today.toISOString().slice(0, 10)}T12:00:00.000Z`)),
        assignedUserId: assignee,
        createdByUserId: input.actorUserId,
        jobId: contract.jobId,
        source: "auto",
        sourceKey: requestSourceKey(request.id),
      },
      { actorUserId: input.actorUserId },
    );
    await prisma.laborPaymentRequest.update({ where: { id: request.id }, data: { taskId: task.id } });
    if (lines.length) await prisma.laborContractTask.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { paymentRequestId: request.id } });
  } catch (err) {
    // No task means nobody was told: the request must not linger as if they had been.
    await prisma.laborPaymentRequest.delete({ where: { id: request.id } }).catch(() => undefined);
    throw err;
  }

  await recordAudit({ actorUserId: input.actorUserId, entityType: "LaborPaymentRequest", entityId: request.id, action: "create", after: { contractId: contract.id, amount: input.amount, assignedUserId: assignee, lineIds: lines.map((l) => l.id) } });
  return prisma.laborPaymentRequest.findUniqueOrThrow({ where: { id: request.id }, include: REQUEST_INCLUDE });
}

/** The payment was recorded against the request: mark it paid and finish its task. */
export async function settleRequestOnPayment(requestId: string, laborPaymentId: string, actorUserId: string): Promise<void> {
  const r = await prisma.laborPaymentRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, taskId: true } });
  if (!r || r.status !== "REQUESTED") return;
  // Status first: closing the task runs `onRequestTaskClosed`, which must find it already paid.
  await prisma.laborPaymentRequest.update({ where: { id: r.id }, data: { status: "PAID", laborPaymentId, resolvedAt: new Date() } });
  if (r.taskId) await closeTask(r.taskId, "COMPLETED", actorUserId);
  await recordAudit({ actorUserId, entityType: "LaborPaymentRequest", entityId: r.id, action: "paid", after: { laborPaymentId } });
}

export async function cancelPaymentRequest(requestId: string, actorUserId: string): Promise<void> {
  const r = await prisma.laborPaymentRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, taskId: true } });
  if (!r) throw new PaymentRequestError(404, "Payment request not found");
  if (r.status !== "REQUESTED") throw new PaymentRequestError(409, "This request is already closed");
  await prisma.laborPaymentRequest.update({ where: { id: r.id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  // The lines it covered may be requested again.
  await prisma.laborContractTask.updateMany({ where: { paymentRequestId: r.id }, data: { paymentRequestId: null } });
  if (r.taskId) await closeTask(r.taskId, "CANCELLED", actorUserId);
  await recordAudit({ actorUserId, entityType: "LaborPaymentRequest", entityId: r.id, action: "cancel" });
}

/**
 * The request's task was closed. If the request is still open nobody recorded
 * a payment: a cancelled task cancels the request, a completed one leaves it
 * marked "closed, no payment recorded" so the contract card says so instead
 * of the ask silently disappearing. Best-effort; called from the task hook.
 */
export async function onRequestTaskClosed(taskId: string, to: TaskStatus): Promise<void> {
  try {
    const r = await prisma.laborPaymentRequest.findUnique({ where: { taskId }, select: { id: true, status: true } });
    if (!r || r.status !== "REQUESTED") return;
    if (to === "CANCELLED") {
      await prisma.laborPaymentRequest.update({ where: { id: r.id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
      await prisma.laborContractTask.updateMany({ where: { paymentRequestId: r.id }, data: { paymentRequestId: null } });
    } else if (to === "COMPLETED") {
      await prisma.laborPaymentRequest.update({ where: { id: r.id }, data: { status: "CLOSED_UNPAID", resolvedAt: new Date() } });
    }
  } catch (err) {
    logger.exception(err, { where: "labor.onRequestTaskClosed", taskId });
  }
}

async function closeTask(taskId: string, status: "COMPLETED" | "CANCELLED", actorUserId: string): Promise<void> {
  try {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (!t || t.status === "COMPLETED" || t.status === "CANCELLED") return;
    await updateTask({ id: taskId, input: { status }, actorUserId });
  } catch (err) {
    logger.exception(err, { where: "labor.paymentRequest.closeTask", taskId });
  }
}
