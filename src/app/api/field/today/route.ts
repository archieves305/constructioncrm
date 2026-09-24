import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { fromDbDate, isIsoDate, toDbDate, addDays } from "@/lib/labor/dates";
import { taskVisibilityFilter } from "@/lib/tasks/access";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";

// Jobs the signed-in user works with in field mode, with today's and
// yesterday's log status for the home-screen tiles. Office roles see all
// open jobs; CREW_LEAD sees jobs they're field-assigned to or PM of.
const FIELD_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF", "CREW_LEAD", "READ_ONLY"]);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!FIELD_ROLES.has(session.user.role)) return forbidden();

  // The client sends its local date — the server may be in another timezone.
  const dateParam = request.nextUrl.searchParams.get("date");
  const today =
    dateParam && isIsoDate(dateParam)
      ? dateParam
      : new Date().toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);

  const where: Record<string, unknown> = {
    currentStage: { isClosed: false },
  };
  if (session.user.role === "CREW_LEAD") {
    where.OR = [
      { projectManagerId: session.user.id },
      { fieldAssignments: { some: { userId: session.user.id } } },
    ];
  }

  const jobs = await prisma.job.findMany({
    where,
    select: {
      id: true,
      jobNumber: true,
      title: true,
      serviceType: true,
      scheduledDate: true,
      currentStage: { select: { name: true } },
      lead: { select: { propertyAddress1: true, city: true } },
      dailyLogs: {
        where: {
          logDate: { gte: toDbDate(yesterday), lte: toDbDate(today) },
        },
        select: {
          logDate: true,
          status: true,
          returnNote: true,
          laborEntries: { select: { isAbsent: true } },
        },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  // Task chips per job, scoped to what THIS viewer may see: a crew lead's
  // count is their own tasks on the job, not the office's.
  const jobIds = jobs.map((j) => j.id);
  const scope = taskVisibilityFilter(session.user);
  const [openTasks, overdueTasks] = jobIds.length
    ? await Promise.all([
        prisma.task.groupBy({
          by: ["jobId"],
          where: { AND: [{ jobId: { in: jobIds }, status: { in: [...OPEN_TASK_STATUSES] } }, scope] },
          _count: { _all: true },
        }),
        prisma.task.groupBy({
          by: ["jobId"],
          where: {
            AND: [
              { jobId: { in: jobIds }, status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: new Date() } },
              scope,
            ],
          },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const taskCounts: Record<string, { open: number; overdue: number }> = {};
  for (const g of openTasks) if (g.jobId) taskCounts[g.jobId] = { open: g._count._all, overdue: 0 };
  for (const g of overdueTasks) {
    if (!g.jobId) continue;
    taskCounts[g.jobId] ??= { open: 0, overdue: 0 };
    taskCounts[g.jobId].overdue = g._count._all;
  }

  return NextResponse.json({
    date: today,
    jobs: jobs.map((job) => {
      const { dailyLogs, ...rest } = job;
      const todayLog = dailyLogs.find((l) => fromDbDate(l.logDate) === today);
      const yesterdayLog = dailyLogs.find((l) => fromDbDate(l.logDate) === yesterday);
      return {
        ...rest,
        todayLog: todayLog
          ? {
              status: todayLog.status,
              returned: Boolean(todayLog.returnNote) && todayLog.status === "DRAFT",
              crewCount: todayLog.laborEntries.filter((e) => !e.isAbsent).length,
            }
          : null,
        yesterdayUnsubmitted: yesterdayLog?.status === "DRAFT",
        taskCounts: taskCounts[job.id] ?? { open: 0, overdue: 0 },
      };
    }),
  });
}
