import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const stageId = searchParams.get("stageId") || undefined;
  const salesRepId = searchParams.get("salesRepId") || undefined;
  const search = searchParams.get("search") || undefined;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");
  const withTaskCounts = searchParams.get("withTaskCounts") === "true";

  const where: Record<string, unknown> = {};
  if (stageId) where.currentStageId = stageId;
  if (salesRepId) where.salesRepId = salesRepId;
  if (search) {
    where.OR = [
      { jobNumber: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
      { lead: { fullName: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (session.user.role === "SALES_REP") {
    where.salesRepId = session.user.id;
  }

  const [data, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: {
        currentStage: true,
        lead: { select: { id: true, fullName: true, primaryPhone: true, propertyAddress1: true, city: true } },
        salesRep: { select: { id: true, firstName: true, lastName: true } },
        projectManager: { select: { id: true, firstName: true, lastName: true } },
        payments: { select: { paymentType: true, amount: true, status: true } },
        permits: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.job.count({ where }),
  ]);

  let taskCountsByJob: Record<string, { pending: number; overdue: number }> = {};
  if (withTaskCounts && data.length > 0) {
    const jobIds = data.map((j) => j.id);
    const now = new Date();
    const [pendingTasks, overdueTasks] = await Promise.all([
      prisma.task.groupBy({
        by: ["jobId"],
        where: { jobId: { in: jobIds }, status: { in: ["PENDING", "IN_PROGRESS"] } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["jobId"],
        where: {
          jobId: { in: jobIds },
          status: { in: ["PENDING", "IN_PROGRESS"] },
          dueAt: { lt: now },
        },
        _count: { _all: true },
      }),
    ]);
    taskCountsByJob = Object.fromEntries(
      pendingTasks
        .filter((g) => g.jobId)
        .map((g) => [g.jobId as string, { pending: g._count._all, overdue: 0 }]),
    );
    for (const g of overdueTasks) {
      const id = g.jobId as string | null;
      if (!id) continue;
      if (!taskCountsByJob[id]) taskCountsByJob[id] = { pending: 0, overdue: 0 };
      taskCountsByJob[id].overdue = g._count._all;
    }
  }

  const enriched = withTaskCounts
    ? data.map((j) => ({
        ...j,
        taskCounts: taskCountsByJob[j.id] ?? { pending: 0, overdue: 0 },
      }))
    : data;

  return NextResponse.json({ data: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}
