import { prisma } from "@/lib/db/prisma";
import type { Prisma, RoleName } from "@/generated/prisma/client";
import type { UpdateTaskInput } from "@/lib/validators/task";
import type { TaskOwnership } from "./access";
import { diffTask, recordTaskEvent, recordTaskEvents, type TaskSnapshot } from "./events";
import { TASK_DETAIL_INCLUDE, type TaskDetailRow } from "./include";
import { notifyTaskAssigned, notifyTaskBlocked, notifyTaskCompleted } from "./notify";
import { runAfterResponse } from "./defer";
import { parseDueAt } from "./dates";
import { onTaskTransition } from "./transitions";
import { checkEvidence, mergeChecklist, readChecklist } from "@/lib/workflows/evidence";
import { activationDueAt, initialDueAt } from "@/lib/workflows/schedule";
import { loadScheduleContext } from "@/lib/workflows/activation";
import { canOverrideBlockingGate } from "@/lib/workflows/access";

/**
 * The one way a task changes.
 *
 * Lifted out of `PATCH /api/tasks/[id]` so that resolving a field issue —
 * which used to flip the task to COMPLETED with a bare `update` — goes
 * through the same code and gets the same timeline row and completion mail.
 * Authorization stays with the caller: the route checks `canEditTask`, the
 * field-issue route has already checked job access.
 *
 * Workflow steps add a few rules on top, all enforced here so no UI can
 * route around them: completing needs the checklist and evidence; skipping
 * (CANCELLED) needs a reason, and a blocking gate may only be skipped by an
 * admin or manager; a hand-edited due date locks; starting a Not-active
 * step activates it. After the write, `onTaskTransition` wakes dependents.
 */

export class TaskUpdateError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "TaskUpdateError";
  }
}

export type UpdateTaskArgs = {
  id: string;
  input: UpdateTaskInput;
  actorUserId: string;
  /**
   * The actor's login role, for the workflow gates (skip a blocking step,
   * override evidence). Omitted by internal callers, which never skip.
   */
  actorRole?: RoleName | null;
  /** Return false to refuse. Receives the row as it is before the change. */
  authorize?: (existing: TaskOwnership) => boolean;
  notify?: "after" | "inline" | "none";
  /**
   * Engine-only: the workflow completing a step whose requirement it has
   * itself just satisfied (deciding the permit status IS the evidence for
   * "Determine permit requirement"). Never reachable from the API.
   */
  internal?: { bypassEvidence?: boolean; tickChecklist?: boolean; bypassGate?: boolean };
};

export type UpdateTaskResult = {
  task: TaskDetailRow;
  statusChanged: boolean;
  assigneeChanged: boolean;
};

export async function updateTask(args: UpdateTaskArgs): Promise<UpdateTaskResult> {
  const { id, input, actorUserId } = args;
  const notify = args.notify ?? "after";
  const now = new Date();

  const existing = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      priority: true,
      dueAt: true,
      assignedUserId: true,
      createdByUserId: true,
      blockedReason: true,
      leadId: true,
      jobId: true,
      violationCaseId: true,
      title: true,
      remindAt: true,
      fieldIssue: { select: { id: true, status: true } },
      // Workflow
      workflowInstanceId: true,
      workflowTaskKey: true,
      workflowAnchor: true,
      dueOffsetBusinessDays: true,
      blocking: true,
      activatedAt: true,
      dueLocked: true,
      skipReason: true,
      requiredEvidence: true,
      requiredEvidenceParam: true,
      checklist: true,
      inspectionResult: true,
    },
  });
  if (!existing) throw new TaskUpdateError(404, "Task not found");
  if (args.authorize && !args.authorize(existing)) {
    throw new TaskUpdateError(403, "You cannot change this task");
  }
  const isWorkflowStep = typeof existing.workflowTaskKey === "string";
  const inWorkflow = typeof existing.workflowInstanceId === "string";

  // Fields are copied across explicitly rather than spread. A blind spread is
  // what once let the create schema's `priority` default overwrite real values.
  const data: Prisma.TaskUpdateInput = {};
  const extraEvents: { type: "SKIPPED" | "ACTIVATED" | "CHECKLIST_UPDATED" | "NOTE"; body?: string | null; fromValue?: string | null; toValue?: string | null }[] = [];

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;

  // `undefined` means "not mentioned"; `null` means "clear it".
  if (input.dueAt !== undefined) {
    const next = input.dueAt === null ? null : parseDueAt(input.dueAt);
    data.dueAt = next;
    // A new due date is a new clock: overdue escalations start over.
    if ((existing.dueAt?.getTime() ?? null) !== (next?.getTime() ?? null)) {
      data.escalationLevel = 0;
      data.lastEscalatedAt = null;
      // A person chose this date; the engine stops moving it.
      if (inWorkflow && input.dueLocked !== false) data.dueLocked = true;
    }
  }

  // Unlock: hand the date back to the engine and recompute it now.
  if (input.dueLocked === false && existing.dueLocked && inWorkflow && input.dueAt === undefined) {
    data.dueLocked = false;
    const ctx = existing.workflowInstanceId ? await loadScheduleContext(prisma, existing.workflowInstanceId) : null;
    if (ctx && existing.workflowAnchor) {
      const step = { anchor: existing.workflowAnchor, dueOffsetBusinessDays: existing.dueOffsetBusinessDays ?? 0 };
      data.dueAt = existing.activatedAt ? activationDueAt(step, existing.activatedAt, ctx) : initialDueAt(step, ctx);
      data.escalationLevel = 0;
      data.lastEscalatedAt = null;
    }
  } else if (input.dueLocked === true && inWorkflow) {
    data.dueLocked = true;
  }

  // "Remind me on…" — setting or moving it re-arms delivery; clearing it
  // disarms. Recorded on the timeline so "why did I get that?" has an answer.
  let reminderChanged = false;
  let nextRemindAt: Date | null = null;
  if (input.remindAt !== undefined) {
    nextRemindAt = input.remindAt === null ? null : parseDueAt(input.remindAt);
    reminderChanged = (existing.remindAt?.getTime() ?? null) !== (nextRemindAt?.getTime() ?? null);
    if (reminderChanged) {
      data.remindAt = nextRemindAt;
      data.remindedAt = null;
      data.remindSetBy = nextRemindAt ? { connect: { id: actorUserId } } : { disconnect: true };
    }
  }

  const assigneeChanged =
    input.assignedUserId !== undefined && input.assignedUserId !== existing.assignedUserId;
  if (input.assignedUserId !== undefined) {
    data.assignedTo = input.assignedUserId
      ? { connect: { id: input.assignedUserId } }
      : { disconnect: true };
    if (assigneeChanged) data.assignedAt = input.assignedUserId ? now : null;
  }

  // Checklist ticks, merged by key. Applied before the completion gate so
  // "tick the last box and complete" works in one save.
  let checklist = readChecklist(existing.checklist);
  const ticks = args.internal?.tickChecklist ? checklist.map((c) => ({ key: c.key, done: true })) : input.checklist;
  if (ticks?.length && checklist.length > 0) {
    const merged = mergeChecklist(checklist, ticks, { userId: actorUserId, now });
    if (merged.changed) {
      checklist = merged.items;
      data.checklist = checklist as unknown as Prisma.InputJsonValue;
      extraEvents.push({
        type: "CHECKLIST_UPDATED",
        toValue: `${checklist.filter((c) => c.done).length}/${checklist.length}`,
      });
    }
  }

  const nextStatus = input.status ?? existing.status;
  const statusChanged = input.status !== undefined && input.status !== existing.status;

  if (nextStatus === "BLOCKED") {
    const reason = input.blockedReason ?? existing.blockedReason;
    if (!reason?.trim()) {
      throw new TaskUpdateError(400, "A blocked task needs a reason — say what it is waiting on");
    }
  }

  if (statusChanged && input.status === "COMPLETED" && isWorkflowStep && !args.internal?.bypassEvidence) {
    const check = await checkEvidence({ ...existing, checklist: checklist as unknown as Prisma.JsonValue });
    if (!check.ok) {
      const reason = input.evidenceOverrideReason?.trim();
      if (reason && canOverrideBlockingGate(args.actorRole ?? null)) {
        extraEvents.push({ type: "NOTE", body: `Evidence requirement overridden: ${reason}` });
      } else {
        throw new TaskUpdateError(400, check.message, check.hint);
      }
    }
  }

  if (statusChanged && input.status === "CANCELLED" && isWorkflowStep) {
    const reason = (input.skipReason ?? existing.skipReason)?.trim();
    if (!reason) throw new TaskUpdateError(400, "Say why this step is being skipped", "skip_reason");
    if (existing.blocking && !args.internal?.bypassGate && args.actorRole !== undefined && !canOverrideBlockingGate(args.actorRole)) {
      throw new TaskUpdateError(403, "Only an admin or manager can skip a blocking step");
    }
    data.skipReason = reason;
    extraEvents.push({ type: "SKIPPED", body: reason, toValue: existing.blocking ? (args.actorRole ?? "system") : null });
  } else if (input.skipReason !== undefined && nextStatus === "CANCELLED" && isWorkflowStep && input.skipReason?.trim()) {
    data.skipReason = input.skipReason.trim();
  }

  if (input.status !== undefined) {
    data.status = input.status;

    if (input.status === "COMPLETED") {
      data.completedAt = now;
      data.completedBy = { connect: { id: actorUserId } };
    } else if (existing.status === "COMPLETED") {
      // Reopening. Both must be cleared: `undefined` means "leave alone" in
      // Prisma, so the old code left a stale completion on an open task.
      data.completedAt = null;
      data.completedBy = { disconnect: true };
    }

    // A task that is no longer blocked should not keep advertising why it was.
    if (input.status !== "BLOCKED" && existing.status === "BLOCKED") {
      data.blockedReason = null;
    }
    // Un-skipping clears the reason so the step reads as a plain reopen.
    if (input.status !== "CANCELLED" && existing.status === "CANCELLED" && existing.skipReason) {
      data.skipReason = null;
    }

    // Starting or finishing a Not-active step activates it: work began out of order.
    if (inWorkflow && !existing.activatedAt && (input.status === "IN_PROGRESS" || input.status === "COMPLETED" || input.status === "BLOCKED")) {
      data.activatedAt = now;
      extraEvents.push({ type: "ACTIVATED", toValue: "out_of_order" });
      if (data.dueAt === undefined && !existing.dueAt && !existing.dueLocked && existing.workflowInstanceId && existing.workflowAnchor) {
        const ctx = await loadScheduleContext(prisma, existing.workflowInstanceId);
        if (ctx) data.dueAt = activationDueAt({ anchor: existing.workflowAnchor, dueOffsetBusinessDays: existing.dueOffsetBusinessDays ?? 0 }, now, ctx);
      }
    }
  }

  if (input.blockedReason !== undefined && nextStatus === "BLOCKED") {
    data.blockedReason = input.blockedReason;
  }

  const task = await prisma.task.update({ where: { id }, data, include: TASK_DETAIL_INCLUDE });

  const before: TaskSnapshot = {
    status: existing.status,
    priority: existing.priority,
    dueAt: existing.dueAt,
    assignedUserId: existing.assignedUserId,
    blockedReason: existing.blockedReason,
  };
  const afterSnapshot: TaskSnapshot = {
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    assignedUserId: task.assignedUserId,
    blockedReason: task.blockedReason,
  };
  await recordTaskEvents({ taskId: id, actorUserId, events: diffTask(before, afterSnapshot) });
  for (const e of extraEvents) {
    await recordTaskEvent({ taskId: id, actorUserId, type: e.type, body: e.body, fromValue: e.fromValue, toValue: e.toValue });
  }
  if (reminderChanged) {
    await recordTaskEvent({
      taskId: id,
      actorUserId,
      type: "REMINDER_SET",
      toValue: nextRemindAt ? nextRemindAt.toISOString() : null,
    });
  }

  if (statusChanged && task.status === "COMPLETED" && task.leadId) {
    await prisma.activityLog.create({
      data: {
        leadId: task.leadId,
        activityType: "TASK_COMPLETED",
        title: `Task completed: ${task.title}`,
        createdByUserId: actorUserId,
      },
    });
  }

  // Closing the office task also closes the field issue it came from. The
  // sync used to be one-way (issue → task), which left the issue open in the
  // field UI after the office had finished the work. Guarded on the issue's
  // current status so the reverse direction cannot ping-pong.
  if (
    statusChanged &&
    task.status === "COMPLETED" &&
    existing.fieldIssue &&
    existing.fieldIssue.status !== "COMPLETED"
  ) {
    await prisma.fieldIssue.update({
      where: { id: existing.fieldIssue.id },
      data: { status: "COMPLETED", resolvedAt: now, resolvedByUserId: actorUserId },
    });
  }

  // Wake up whatever was waiting on this step. Inline, so the next task
  // exists by the time the response goes back; never throws.
  if (statusChanged && inWorkflow) {
    await onTaskTransition({ taskId: id, from: existing.status, to: task.status, actorUserId, actorRole: args.actorRole ?? null });
  }

  if (notify !== "none") {
    const send = async () => {
      if (statusChanged && task.status === "COMPLETED") {
        await notifyTaskCompleted({ taskId: id, actorUserId });
      } else if (statusChanged && task.status === "BLOCKED") {
        await notifyTaskBlocked({ taskId: id, actorUserId });
      }
      // A reassignment during the same save still tells the new owner. Ordered
      // after completion so a "done and handed over" edit does not send two
      // conflicting mails about the same state.
      if (assigneeChanged && task.assignedUserId && task.status !== "COMPLETED") {
        await notifyTaskAssigned({
          taskId: id,
          actorUserId,
          reassigned: existing.assignedUserId !== null,
        });
      }
    };
    if (notify === "inline") await send();
    else runAfterResponse(send, { where: "updateTask", taskId: id });
  }

  return { task, statusChanged, assigneeChanged };
}
