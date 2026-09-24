import { addDays, format } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { InvoiceStatus, Priority } from "@/generated/prisma/client";
import { createTask } from "./create";
import { onTaskTransition } from "./transitions";
import { recordTaskEvent } from "./events";
import { dueInBusinessDays, dueTomorrow } from "./due-dates";
import { OPEN_TASK_STATUSES } from "./status";

/**
 * Follow-up tasks the system raises on its own when a business event
 * happens, and closes again when the event resolves.
 *
 * Hard-coded, typed rules rather than the lead-only FollowUpRule engine: these
 * need to attach to invoices, daily logs and change orders, and — the part
 * FollowUpRule cannot do — find and close the task later. Idempotent through
 * `sourceKey`: an OPEN task with the same key is never duplicated, but a
 * closed one does not stop a re-sent estimate from raising a fresh follow-up.
 *
 * Every entry point is best-effort and runs post-commit: the business write
 * already succeeded, so a failure here is logged, never thrown.
 */

export type AutoTaskKind = "estimate.sent" | "invoice.sent" | "daily-log.returned" | "change-order.sent";

export type AutoTaskSource =
  | { kind: "estimate.sent"; estimateId: string }
  | { kind: "invoice.sent"; invoiceId: string }
  | { kind: "daily-log.returned"; dailyLogId: string; crewLeadUserId: string | null }
  | { kind: "change-order.sent"; changeOrderId: string };

export function sourceKeyFor(s: AutoTaskSource): string {
  switch (s.kind) {
    case "estimate.sent":
      return `estimate:SENT:${s.estimateId}`;
    case "invoice.sent":
      return `invoice:SENT:${s.invoiceId}`;
    case "daily-log.returned":
      return `daily-log:RETURNED:${s.dailyLogId}`;
    case "change-order.sent":
      return `change-order:SENT:${s.changeOrderId}`;
  }
}

export function isRuleEnabled(kind: AutoTaskKind, disabledList: string = env.TASK_AUTO_RULES_DISABLED): boolean {
  return !disabledList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(kind);
}

type TaskSpec = {
  title: string;
  description?: string | null;
  priority: Priority;
  dueAt: Date;
  assignedUserId: string | null;
  leadId?: string | null;
  jobId?: string | null;
  estimateId?: string | null;
  invoiceId?: string | null;
  dailyLogId?: string | null;
};

const money = (n: unknown) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function oldestActiveOfficeStaff(): Promise<string | null> {
  const u = await prisma.user.findFirst({
    where: { isActive: true, role: { name: "OFFICE_STAFF" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return u?.id ?? null;
}

/** Per-kind: load the entity and describe the task it wants. Null when the entity is gone. */
async function specFor(source: AutoTaskSource, now: Date): Promise<TaskSpec | null> {
  switch (source.kind) {
    case "estimate.sent": {
      const e = await prisma.estimate.findUnique({
        where: { id: source.estimateId },
        select: {
          estimateNumber: true,
          name: true,
          totalPrice: true,
          createdByUserId: true,
          leadId: true,
          lead: { select: { fullName: true, assignedUserId: true } },
        },
      });
      if (!e) return null;
      return {
        title: `Follow up with ${e.lead.fullName} on estimate ${e.estimateNumber}`,
        description: `${e.name} — ${money(e.totalPrice)}. Sent ${format(now, "MMM d")}.`,
        priority: "MEDIUM",
        dueAt: dueInBusinessDays(3, now),
        assignedUserId: e.lead.assignedUserId ?? e.createdByUserId,
        leadId: e.leadId,
        estimateId: source.estimateId,
      };
    }
    case "invoice.sent": {
      const inv = await prisma.invoice.findUnique({
        where: { id: source.invoiceId },
        select: {
          invoiceNumber: true,
          amount: true,
          dueDate: true,
          issueDate: true,
          jobId: true,
          job: { select: { jobNumber: true, title: true, projectManagerId: true, salesRepId: true } },
        },
      });
      if (!inv) return null;
      const dueAt = inv.dueDate ?? addDays(inv.issueDate, 30);
      return {
        title: `Collect payment on ${inv.invoiceNumber}`,
        description: `${money(inv.amount)} due ${format(dueAt, "MMM d, yyyy")}. ${inv.job.jobNumber} — ${inv.job.title}.`,
        priority: "MEDIUM",
        dueAt,
        assignedUserId: inv.job.projectManagerId ?? inv.job.salesRepId ?? (await oldestActiveOfficeStaff()),
        jobId: inv.jobId,
        invoiceId: source.invoiceId,
      };
    }
    case "daily-log.returned": {
      const log = await prisma.dailyLog.findUnique({
        where: { id: source.dailyLogId },
        select: {
          logDate: true,
          returnNote: true,
          managerUserId: true,
          jobId: true,
          job: {
            select: {
              jobNumber: true,
              fieldAssignments: { take: 1, orderBy: { createdAt: "asc" }, select: { userId: true } },
            },
          },
        },
      });
      if (!log) return null;
      return {
        title: `Fix returned daily log ${format(log.logDate, "MMM d")} — ${log.job.jobNumber}`,
        description: log.returnNote,
        priority: "HIGH",
        dueAt: dueTomorrow(now),
        assignedUserId:
          source.crewLeadUserId ?? log.managerUserId ?? log.job.fieldAssignments[0]?.userId ?? null,
        jobId: log.jobId,
        dailyLogId: source.dailyLogId,
      };
    }
    case "change-order.sent": {
      const co = await prisma.changeOrder.findUnique({
        where: { id: source.changeOrderId },
        select: {
          number: true,
          title: true,
          createdByUserId: true,
          jobId: true,
          job: { select: { projectManagerId: true, lead: { select: { fullName: true } } } },
        },
      });
      if (!co) return null;
      return {
        title: `Follow up on CO-${co.number}${co.title ? ` — ${co.title}` : ""} with ${co.job.lead.fullName}`,
        priority: "MEDIUM",
        dueAt: dueInBusinessDays(3, now),
        assignedUserId: co.job.projectManagerId ?? co.createdByUserId,
        jobId: co.jobId,
      };
    }
  }
}

export type EnsureResult = {
  created: boolean;
  taskId: string | null;
  reason?: "exists" | "disabled" | "entity-missing" | "error";
};

/**
 * Raise the follow-up for an event unless an open one already exists.
 * `actorUserId` becomes the task's creator, so the assignment mail reads
 * "Jo assigned you…" — honest, and keeps `createdBy` non-null.
 */
export async function ensureAutoTask(
  source: AutoTaskSource,
  actorUserId: string,
  now: Date = new Date(),
): Promise<EnsureResult> {
  const sourceKey = sourceKeyFor(source);
  try {
    if (!isRuleEnabled(source.kind)) return { created: false, taskId: null, reason: "disabled" };

    const open = await prisma.task.findFirst({
      where: { sourceKey, status: { in: [...OPEN_TASK_STATUSES] } },
      select: { id: true },
    });
    if (open) return { created: false, taskId: open.id, reason: "exists" };

    const spec = await specFor(source, now);
    if (!spec) return { created: false, taskId: null, reason: "entity-missing" };

    const task = await createTask(
      { ...spec, createdByUserId: actorUserId, sourceKey, source: "auto" },
      // Already post-commit (inside after()), so send now rather than
      // nesting another deferral.
      { actorUserId, notify: "inline" },
    );
    return { created: true, taskId: task.id };
  } catch (err) {
    logger.exception(err, { where: "auto-tasks.ensure", sourceKey });
    return { created: false, taskId: null, reason: "error" };
  }
}

/** Close every open task raised for an event, with a timeline row saying why. */
export async function closeAutoTask(
  sourceKey: string,
  opts: { actorUserId: string | null; outcome: "COMPLETED" | "CANCELLED"; because: string },
): Promise<{ closed: number }> {
  try {
    const open = await prisma.task.findMany({
      where: { sourceKey, status: { in: [...OPEN_TASK_STATUSES] } },
      select: { id: true, status: true },
    });
    if (open.length === 0) return { closed: 0 };
    const now = new Date();
    await prisma.task.updateMany({
      where: { id: { in: open.map((t) => t.id) } },
      data: {
        status: opts.outcome,
        completedAt: opts.outcome === "COMPLETED" ? now : null,
        completedByUserId: opts.outcome === "COMPLETED" ? opts.actorUserId : null,
        blockedReason: null,
      },
    });
    for (const t of open) {
      await recordTaskEvent({
        taskId: t.id,
        actorUserId: opts.actorUserId,
        type: "AUTO_CLOSED",
        toValue: opts.outcome,
        body: opts.because,
      });
      await onTaskTransition({ taskId: t.id, from: t.status, to: opts.outcome, actorUserId: opts.actorUserId });
    }
    return { closed: open.length };
  } catch (err) {
    logger.exception(err, { where: "auto-tasks.close", sourceKey });
    return { closed: 0 };
  }
}

export type InvoiceTransition = { from: InvoiceStatus; to: InvoiceStatus };

/** Map an invoice status change onto the collect-payment task. */
export async function onInvoiceTransition(
  invoiceId: string,
  transition: InvoiceTransition | null | undefined,
  actorUserId: string | null,
): Promise<void> {
  if (!transition || transition.from === transition.to) return;
  const key = sourceKeyFor({ kind: "invoice.sent", invoiceId });
  if (transition.to === "SENT") {
    if (actorUserId) await ensureAutoTask({ kind: "invoice.sent", invoiceId }, actorUserId);
  } else if (transition.to === "PAID") {
    await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because: "invoice paid" });
  } else if (transition.to === "VOID") {
    await closeAutoTask(key, { actorUserId, outcome: "CANCELLED", because: "invoice voided" });
  }
}

export async function onEstimateTransition(
  estimateId: string,
  from: string,
  to: string,
  actorUserId: string,
): Promise<void> {
  if (from === to) return;
  const key = sourceKeyFor({ kind: "estimate.sent", estimateId });
  if (to === "SENT") {
    const r = await ensureAutoTask({ kind: "estimate.sent", estimateId }, actorUserId);
    // First thing in the CRM that ever advances the lead's follow-up date.
    if (r.created && r.taskId) {
      const t = await prisma.task.findUnique({ where: { id: r.taskId }, select: { leadId: true, dueAt: true } });
      if (t?.leadId && t.dueAt) {
        await prisma.lead.updateMany({
          where: { id: t.leadId, OR: [{ nextFollowUpAt: null }, { nextFollowUpAt: { gt: t.dueAt } }] },
          data: { nextFollowUpAt: t.dueAt },
        });
      }
    }
  } else if (to === "ACCEPTED") {
    await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because: "estimate accepted" });
  } else if (to === "DECLINED") {
    await closeAutoTask(key, { actorUserId, outcome: "CANCELLED", because: "estimate declined" });
  }
}
