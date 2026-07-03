import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { canSeeLaborCosts } from "@/lib/labor/permissions";
import { summarizeLogList } from "@/lib/labor/log-service";
import { isIsoDate, toDbDate } from "@/lib/labor/dates";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const status = searchParams.get("status");

  const where: Record<string, unknown> = { jobId };
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
      returnNote: true,
      updatedAt: true,
      manager: { select: { id: true, firstName: true, lastName: true } },
      laborEntries: {
        select: {
          isAbsent: true,
          personnelId: true,
          totalHours: true,
          totalCost: true,
        },
      },
    },
    orderBy: { logDate: "desc" },
    take: 120,
  });

  return NextResponse.json(
    summarizeLogList(logs, canSeeLaborCosts(ctx.session.user.role)),
  );
}
