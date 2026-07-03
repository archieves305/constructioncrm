import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { fromDbDate, isIsoDate, toDbDate, addDays } from "@/lib/labor/dates";

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
      };
    }),
  });
}
