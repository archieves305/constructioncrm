import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createTaskSchema } from "@/lib/validators/task";
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
    where.status = { in: ["PENDING", "IN_PROGRESS"] };
  }

  if (overdue) {
    where.dueAt = { lt: new Date() };
    where.status = { in: ["PENDING", "IN_PROGRESS"] };
  }

  if (session.user.role === "SALES_REP") {
    where.assignedUserId = session.user.id;
  }

  const tasks = await prisma.task.findMany({
    where,
    include: {
      lead: { select: { id: true, fullName: true } },
      job: { select: { id: true, jobNumber: true, title: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest(JSON.stringify(parsed.error.issues));

  const input = parsed.data;

  const task = await prisma.task.create({
    data: {
      ...input,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      createdByUserId: session.user.id,
    },
    include: {
      lead: { select: { id: true, fullName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Log activity on lead
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

  return NextResponse.json(task, { status: 201 });
}
