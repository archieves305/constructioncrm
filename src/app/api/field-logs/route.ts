import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canSeeLaborCosts } from "@/lib/labor/permissions";
import { summarizeLogList } from "@/lib/labor/log-service";
import { isIsoDate, toDbDate } from "@/lib/labor/dates";

// Cross-job daily-log queue for the office (approval workflow).
const OFFICE_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF"]);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!OFFICE_ROLES.has(session.user.role)) return forbidden();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  const dateFilter: Record<string, Date> = {};
  if (from && isIsoDate(from)) dateFilter.gte = toDbDate(from);
  if (to && isIsoDate(to)) dateFilter.lte = toDbDate(to);
  if (Object.keys(dateFilter).length) where.logDate = dateFilter;

  const logs = await prisma.dailyLog.findMany({
    where,
    select: {
      id: true,
      jobId: true,
      logDate: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      updatedAt: true,
      job: { select: { id: true, jobNumber: true, title: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      submittedBy: { select: { id: true, firstName: true, lastName: true } },
      laborEntries: {
        select: {
          isAbsent: true,
          personnelId: true,
          totalHours: true,
          totalCost: true,
        },
      },
    },
    orderBy: [{ logDate: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json(
    summarizeLogList(logs, canSeeLaborCosts(session.user.role)),
  );
}
