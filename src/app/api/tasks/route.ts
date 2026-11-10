import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { withIdempotency } from "@/lib/api/idempotency";
import { createTaskSchema } from "@/lib/validators/task";
import { buildTaskListWhere, readTaskListParams } from "@/lib/tasks/query";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { TASK_LIST_INCLUDE } from "@/lib/tasks/include";
import { createTask, TaskLinkError } from "@/lib/tasks/create";
import { parseDueAt } from "@/lib/tasks/dates";
import { applySchedule, EMPTY_SCHEDULE } from "@/lib/calendar/schedule";
import { canCreateTasks } from "@/lib/access/roles";
import { parseSort, TASK_SORT_DEFAULT, TASK_SORT_KEYS } from "@/lib/lists/sort";
import { taskOrderBy } from "@/lib/lists/sort-order";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const scope = await visibilityScopeFor(session.user);
  const where = buildTaskListWhere(readTaskListParams(request.nextUrl.searchParams), session.user, new Date(), scope);

  const tasks = await prisma.task.findMany({
    where,
    include: TASK_LIST_INCLUDE,
    // ?sort=&dir= through the allow-list in lib/lists/sort.ts (default: due date, then priority).
    orderBy: taskOrderBy(parseSort(request.nextUrl.searchParams, TASK_SORT_KEYS, TASK_SORT_DEFAULT)),
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canCreateTasks(session.user.role)) return forbidden(session.user.role === "CREW_MEMBER" ? "A crew member reports a problem instead of raising a task; the office or the foreman makes the task." : "A read-only account can look at tasks but not raise them.");

  // A task created on a phone that lost signal may be sent twice.
  const user = session.user;
  return withIdempotency(request, user.id, "POST /api/tasks", async () => {
    const parsed = await validateBody(request, createTaskSchema);
    if (!parsed.ok) return parsed.response;
    const input = parsed.data;

    // Same rules as PATCH: a bare day pins to noon, a time needs a start, etc.
    const sched = applySchedule(EMPTY_SCHEDULE, { dueAt: input.dueAt, scheduledStart: input.scheduledStart, allDay: input.allDay });
    if (!sched.ok) return badRequest(sched.error);

    try {
      const task = await createTask(
        {
          title: input.title,
          description: input.description,
          priority: input.priority,
          dueAt: sched.next.dueAt,
          scheduledStart: sched.next.scheduledStart,
          allDay: sched.next.allDay,
          assignedUserId: input.assignedUserId,
          createdByUserId: session.user.id,
          leadId: input.leadId,
          jobId: input.jobId,
          estimateId: input.estimateId,
          invoiceId: input.invoiceId,
          prospectId: input.prospectId,
          dailyLogId: input.dailyLogId,
          violationCaseId: input.violationCaseId,
          violationItemId: input.violationItemId,
          permitId: input.permitId,
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
  });
}
