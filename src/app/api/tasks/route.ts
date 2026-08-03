import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { createTaskSchema } from "@/lib/validators/task";
import { taskVisibilityFilter } from "@/lib/tasks/access";
import { recordTaskEvent } from "@/lib/tasks/events";
import { notifyTaskAssigned } from "@/lib/tasks/notify";
import { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const assignedUserId = searchParams.get("assignedUserId") || undefined;
  const status = searchParams.get("status") || undefined;
  const priority = searchParams.get("priority") || undefined;
  const leadId = searchParams.get("leadId") || undefined;
  const jobId = searchParams.get("jobId") || undefined;
  const overdue = searchParams.get("overdue") === "true";
  const includeCompleted = searchParams.get("includeCompleted") === "true";

  const where: Prisma.TaskWhereInput = {};

  if (assignedUserId) where.assignedUserId = assignedUserId;
  if (priority) where.priority = priority as Prisma.EnumPriorityFilter["equals"];
  if (leadId) where.leadId = leadId;
  if (jobId) where.jobId = jobId;

  if (status) {
    where.status = status as Prisma.EnumTaskStatusFilter["equals"];
  } else if (!includeCompleted && !overdue) {
    // BLOCKED counts as open — a stalled task is exactly the one that should
    // stay in front of people, not drop off the default list.
    where.status = { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] };
  }

  if (overdue) {
    where.dueAt = { lt: new Date() };
    where.status = { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] };
  }

  const scope = taskVisibilityFilter(session.user);

  const tasks = await prisma.task.findMany({
    where: { AND: [where, scope] },
    include: {
      lead: { select: { id: true, fullName: true } },
      job: { select: { id: true, jobNumber: true, title: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      _count: { select: { events: { where: { type: "NOTE" } } } },
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = await validateBody(request, createTaskSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const task = await prisma.task.create({
    data: {
      ...input,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      assignedAt: input.assignedUserId ? new Date() : undefined,
      createdByUserId: session.user.id,
    },
    include: {
      lead: { select: { id: true, fullName: true } },
      job: { select: { id: true, jobNumber: true, title: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await recordTaskEvent({
    taskId: task.id,
    actorUserId: session.user.id,
    type: "CREATED",
  });

  if (task.assignedUserId) {
    await recordTaskEvent({
      taskId: task.id,
      actorUserId: session.user.id,
      type: "ASSIGNED",
      toValue: task.assignedUserId,
    });
  }

  if (task.leadId) {
    await prisma.activityLog.create({
      data: {
        leadId: task.leadId,
        activityType: "TASK_CREATED",
        title: `Task created: ${task.title}`,
        createdByUserId: session.user.id,
      },
    });
  }

  // Mail goes out after the response. The task exists either way; holding the
  // caller for a third-party API round-trip only makes the UI feel slow.
  if (task.assignedUserId) {
    after(async () => {
      await notifyTaskAssigned({ taskId: task.id, actorUserId: session.user.id });
    });
  }

  return NextResponse.json(task, { status: 201 });
}
