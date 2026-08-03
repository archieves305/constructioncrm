import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { updateTaskSchema } from "@/lib/validators/task";
import { canEditTask, canViewTask } from "@/lib/tasks/access";
import { diffTask, recordTaskEvents, type TaskSnapshot } from "@/lib/tasks/events";
import { notifyTaskAssigned, notifyTaskBlocked, notifyTaskCompleted } from "@/lib/tasks/notify";
import { Prisma } from "@/generated/prisma/client";

const DETAIL_INCLUDE = {
  lead: { select: { id: true, fullName: true } },
  job: { select: { id: true, jobNumber: true, title: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  watchers: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  events: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      body: true,
      fromValue: true,
      toValue: true,
      editedAt: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.TaskInclude;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canViewTask(session.user, task)) return forbidden();

  return NextResponse.json(task);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const parsed = await validateBody(request, updateTaskSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

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
    },
  });
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canEditTask(session.user, existing)) return forbidden();

  // Fields are copied across explicitly rather than spread. A blind spread is
  // what let the create schema's `priority` default overwrite real values.
  const data: Prisma.TaskUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;

  // `undefined` means "not mentioned"; `null` means "clear it".
  if (input.dueAt !== undefined) {
    data.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
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
      return badRequest("A blocked task needs a reason — say what it is waiting on");
    }
  }

  if (input.status !== undefined) {
    data.status = input.status;

    if (input.status === "COMPLETED") {
      data.completedAt = new Date();
      data.completedBy = { connect: { id: session.user.id } };
    } else if (existing.status === "COMPLETED") {
      // Reopening. Both must be cleared: `completedAt: undefined` means "leave
      // alone" in Prisma, so the old code left a stale completion timestamp
      // (and now a stale completer) on a task that is open again.
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

  const task = await prisma.task.update({
    where: { id },
    data,
    include: DETAIL_INCLUDE,
  });

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
  await recordTaskEvents({
    taskId: id,
    actorUserId: session.user.id,
    events: diffTask(before, afterSnapshot),
  });

  if (statusChanged && task.status === "COMPLETED" && task.leadId) {
    await prisma.activityLog.create({
      data: {
        leadId: task.leadId,
        activityType: "TASK_COMPLETED",
        title: `Task completed: ${task.title}`,
        createdByUserId: session.user.id,
      },
    });
  }

  const actorUserId = session.user.id;
  after(async () => {
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
  });

  return NextResponse.json(task);
}
