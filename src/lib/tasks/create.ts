import { prisma } from "@/lib/db/prisma";
import type { Prisma, Priority } from "@/generated/prisma/client";
import { TASK_LIST_INCLUDE, type TaskListRow } from "./include";
import { notifyTaskAssigned } from "./notify";
import { runAfterResponse } from "./defer";

/**
 * The one way a task comes into existence.
 *
 * Before this, five code paths called `prisma.task.create` directly — the
 * deposit task on job creation, stage templates, follow-up rules, field
 * issues and the API — and only the API wrote a CREATED event or told the
 * assignee. A task that arrived silently with an empty timeline read as lost
 * history and nobody knew it was theirs. Everything now comes through here.
 *
 * Events are written through the same client as the task (a transaction when
 * the caller is in one) so they commit or roll back together. Mail is
 * deferred to after the response by default; `notifyTaskAssigned` re-reads
 * the task, so a rolled-back transaction simply sends nothing.
 */

/** Where a task came from. Recorded as the CREATED event's `toValue`. */
export type TaskSource =
  | "manual"
  | "job_deposit"
  | "stage_template"
  | "follow_up_rule"
  | "field_issue"
  | "auto";

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  priority?: Priority;
  dueAt?: Date | null;
  assignedUserId?: string | null;
  createdByUserId: string;
  leadId?: string | null;
  jobId?: string | null;
  estimateId?: string | null;
  invoiceId?: string | null;
  prospectId?: string | null;
  dailyLogId?: string | null;
  watcherUserIds?: string[];
  source?: TaskSource;
  // Reserved for Stage 2 automation and reminders; accepted now so the
  // signature does not churn.
  sourceKey?: string | null;
};

export type CreateTaskOptions = {
  /** Transaction client when the caller is inside one. */
  db?: Prisma.TransactionClient;
  /**
   * Who did it, for the timeline and for suppressing "you assigned this to
   * yourself" mail. `null` means the system; defaults to `createdByUserId`.
   */
  actorUserId?: string | null;
  /** "after" defers mail past the response; "inline" awaits it; "none" skips. */
  notify?: "after" | "inline" | "none";
  /** Write a TASK_CREATED row to the lead's activity feed. Default true. */
  logLeadActivity?: boolean;
};

export class TaskLinkError extends Error {
  constructor(
    public readonly field: string,
    public readonly id: string,
  ) {
    super(`${field} "${id}" does not exist`);
    this.name = "TaskLinkError";
  }
}

type ParentLinks = { leadId: string | null; jobId: string | null };

/**
 * A task on an invoice or daily log belongs to that job; one on an estimate
 * or promoted prospect belongs to that lead. Filling the parent in means the
 * job panel, the visibility filter and the email context all keep working
 * without knowing about the finer-grained link.
 */
async function resolveParentLinks(
  db: Prisma.TransactionClient,
  input: CreateTaskInput,
): Promise<ParentLinks> {
  let leadId = input.leadId ?? null;
  let jobId = input.jobId ?? null;

  if (input.invoiceId) {
    const inv = await db.invoice.findUnique({ where: { id: input.invoiceId }, select: { jobId: true } });
    if (!inv) throw new TaskLinkError("invoiceId", input.invoiceId);
    jobId ??= inv.jobId;
  }
  if (input.dailyLogId) {
    const log = await db.dailyLog.findUnique({ where: { id: input.dailyLogId }, select: { jobId: true } });
    if (!log) throw new TaskLinkError("dailyLogId", input.dailyLogId);
    jobId ??= log.jobId;
  }
  if (input.estimateId) {
    const est = await db.estimate.findUnique({ where: { id: input.estimateId }, select: { leadId: true } });
    if (!est) throw new TaskLinkError("estimateId", input.estimateId);
    leadId ??= est.leadId;
  }
  if (input.prospectId) {
    const p = await db.prospect.findUnique({ where: { id: input.prospectId }, select: { leadId: true } });
    if (!p) throw new TaskLinkError("prospectId", input.prospectId);
    leadId ??= p.leadId;
  }
  if (jobId && !leadId) {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { leadId: true } });
    if (!job) throw new TaskLinkError("jobId", jobId);
    leadId = job.leadId;
  }
  return { leadId, jobId };
}

export async function createTask(
  input: CreateTaskInput,
  opts: CreateTaskOptions = {},
): Promise<TaskListRow> {
  const db = opts.db ?? prisma;
  const actorUserId = opts.actorUserId === undefined ? input.createdByUserId : opts.actorUserId;
  const notify = opts.notify ?? "after";
  const now = new Date();

  const parents = await resolveParentLinks(db, input);
  const assignedUserId = input.assignedUserId ?? null;

  const task = await db.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "MEDIUM",
      dueAt: input.dueAt ?? null,
      assignedUserId,
      assignedAt: assignedUserId ? now : null,
      createdByUserId: input.createdByUserId,
      leadId: parents.leadId,
      jobId: parents.jobId,
      estimateId: input.estimateId ?? null,
      invoiceId: input.invoiceId ?? null,
      prospectId: input.prospectId ?? null,
      dailyLogId: input.dailyLogId ?? null,
    },
    include: TASK_LIST_INCLUDE,
  });

  const events: Prisma.TaskEventCreateManyInput[] = [
    { taskId: task.id, actorUserId, type: "CREATED", toValue: input.source ?? "manual" },
  ];
  if (assignedUserId) {
    events.push({ taskId: task.id, actorUserId, type: "ASSIGNED", toValue: assignedUserId });
  }

  const watcherIds = Array.from(new Set(input.watcherUserIds ?? [])).filter(
    (id) => id !== assignedUserId && id !== input.createdByUserId,
  );
  if (watcherIds.length > 0) {
    await db.taskWatcher.createMany({
      data: watcherIds.map((userId) => ({ taskId: task.id, userId })),
      skipDuplicates: true,
    });
    for (const userId of watcherIds) {
      events.push({ taskId: task.id, actorUserId, type: "WATCHER_ADDED", toValue: userId });
    }
  }
  await db.taskEvent.createMany({ data: events });

  if (parents.leadId && (opts.logLeadActivity ?? true)) {
    await db.activityLog.create({
      data: {
        leadId: parents.leadId,
        activityType: "TASK_CREATED",
        title: `Task created: ${task.title}`,
        createdByUserId: input.createdByUserId,
      },
    });
  }

  if (assignedUserId && notify !== "none") {
    const send = () => notifyTaskAssigned({ taskId: task.id, actorUserId });
    if (notify === "inline") await send();
    else runAfterResponse(send, { where: "createTask", taskId: task.id });
  }

  return task;
}
