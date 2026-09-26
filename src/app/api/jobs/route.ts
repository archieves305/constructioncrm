import { NextRequest, NextResponse } from "next/server";
import { LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { prisma } from "@/lib/db/prisma";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { buildJobListWhere, hasWorkflowFilter, parseJobListParams } from "@/lib/jobs/query";
import { loadJobWorkflowSummaries } from "@/lib/workflows/summary";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");
  const withTaskCounts = searchParams.get("withTaskCounts") === "true";
  const params = parseJobListParams(searchParams);
  // Any workflow filter implies the summary: the list has to show why a job matched.
  const withWorkflow = searchParams.get("withWorkflow") === "true" || hasWorkflowFilter(params);
  const now = new Date();

  const where = buildJobListWhere(params, { user: { id: session.user.id, role: session.user.role }, now });

  const [data, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: {
        currentStage: true,
        lead: { select: { ...LEAD_LABEL_SELECT, primaryPhone: true } },
        salesRep: { select: { id: true, firstName: true, lastName: true } },
        projectManager: { select: { id: true, firstName: true, lastName: true } },
        payments: { select: { paymentType: true, amount: true, status: true } },
        permits: { select: { id: true, status: true } },
        // Latest stage change only, so boards can say "6d in stage".
        stageHistory: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.job.count({ where }),
  ]);

  const jobIds = data.map((j) => j.id);

  let taskCountsByJob: Record<string, { pending: number; overdue: number }> = {};
  if (withTaskCounts && jobIds.length > 0) {
    const [pendingTasks, overdueTasks] = await Promise.all([
      prisma.task.groupBy({
        by: ["jobId"],
        where: { jobId: { in: jobIds }, ...ACTIVE_OPEN_WHERE },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["jobId"],
        where: {
          jobId: { in: jobIds },
          ...ACTIVE_OPEN_WHERE,
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

  const workflowByJob = withWorkflow ? await loadJobWorkflowSummaries(jobIds, now) : null;

  const enriched = data.map((j) => ({
    ...j,
    ...(withTaskCounts && { taskCounts: taskCountsByJob[j.id] ?? { pending: 0, overdue: 0 } }),
    ...(workflowByJob && { workflow: workflowByJob.get(j.id) ?? null }),
  }));

  return NextResponse.json({ data: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}
