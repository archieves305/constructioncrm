import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { UpdateTaskInput } from "@/lib/validators/task";
import type { TaskOwnership } from "./access";
import { diffTask, recordTaskEvent, recordTaskEvents, type TaskSnapshot } from "./events";
import { TASK_DETAIL_INCLUDE, type TaskDetailRow } from "./include";
import { notifyTaskAssigned, notifyTaskBlocked, notifyTaskCompleted } from "./notify";
import { runAfterResponse } from "./defer";
import { parseDueAt } from "./dates";

/**
 * The one way a task changes.
 *
 * Lifted out of `PATCH /api/tasks/[id]` so that resolving a field issue —
 * which used to flip the task to COMPLETED with a bare `update` — goes
 * through the same code and gets the same timeline row and completion mail.
 * Authorization stays with the caller: the route checks `canEditTask`, the
 * field-issue route has already checked job access.
 */

export class TaskUpdateError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "TaskUpdateError";
  }
}

export type UpdateTaskArgs = {
  id: string;
  input: UpdateTaskInput;
  actorUserId: string;
  /** Return false to refuse. Receives the row as it is before the change. */
  authorize?: (existing: TaskOwnership) => boolean;
  notify?: "after" | "inline" | "none";
};

export type UpdateTaskResult = {
  task: TaskDetailRow;
  statusChanged: boolean;
  assigneeChanged: boolean;
};

export async function updateTask(args: UpdateTaskArgs): Promise<UpdateTaskResult> {
  const { id, input, actorUserId } = args;
  const notify = args.notify ?? "after";

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
      title: true,
      remindAt: true,
      fieldIssue: { select: { id: true, status: true } },
    },
  });
  if (!existing) throw new TaskUpdateError(404, "Task not found");
  if (args.authorize && !args.authorize(existing)) {
    throw new TaskUpdateError(403, "You cannot change this task");
  }

  // Fields are copied across explicitly rather than spread. A blind spread is
  // what once let the create schema's `priority` default overwrite real values.
  const data: Prisma.TaskUpdateInput = {};

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
    }
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
    if (assigneeChanged) data.assignedAt = input.assignedUserId ? new Date() : null;
  }

  const nextStatus = input.status ?? existing.status;
  const statusChanged = input.status !== undefined && input.status !== existing.status;

  if (nextStatus === "BLOCKED") {
    const reason = input.blockedReason ?? existing.blockedReason;
    if (!reason?.trim()) {
      throw new TaskUpdateError(400, "A blocked task needs a reason — say what it is waiting on");
    }
  }

  if (input.status !== undefined) {
    data.status = input.status;

    if (input.status === "COMPLETED") {
      data.completedAt = new Date();
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
      data: { status: "COMPLETED", resolvedAt: new Date(), resolvedByUserId: actorUserId },
    });
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
