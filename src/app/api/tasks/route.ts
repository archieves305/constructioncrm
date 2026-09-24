import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { createTaskSchema } from "@/lib/validators/task";
import { buildTaskListWhere, readTaskListParams } from "@/lib/tasks/query";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { TASK_LIST_INCLUDE } from "@/lib/tasks/include";
import { createTask, TaskLinkError } from "@/lib/tasks/create";
import { parseDueAt } from "@/lib/tasks/dates";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const scope = await visibilityScopeFor(session.user);
  const where = buildTaskListWhere(readTaskListParams(request.nextUrl.searchParams), session.user, new Date(), scope);

  const tasks = await prisma.task.findMany({
    where,
    include: TASK_LIST_INCLUDE,
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "READ_ONLY") return forbidden();

  const parsed = await validateBody(request, createTaskSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  try {
    const task = await createTask(
      {
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt: input.dueAt ? parseDueAt(input.dueAt) : null,
        assignedUserId: input.assignedUserId,
        createdByUserId: session.user.id,
        leadId: input.leadId,
        jobId: input.jobId,
        estimateId: input.estimateId,
        invoiceId: input.invoiceId,
        prospectId: input.prospectId,
        dailyLogId: input.dailyLogId,
        watcherUserIds: input.watcherUserIds,
        remindAt: input.remindAt ? parseDueAt(input.remindAt) : null,
        source: "manual",
      },
      { actorUserId: session.user.id },
    );
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    if (err instanceof TaskLinkError) return badRequest(err.message);
    throw err;
  }
}
