import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const type = searchParams.get("type") || "dashboard";

  const dateFilter = {
    ...(dateFrom && { gte: new Date(dateFrom) }),
    ...(dateTo && { lte: new Date(dateTo) }),
  };
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  if (type === "dashboard") {
    const [totalLeads, stages, sources, reps, overdueTasks] = await Promise.all([
      prisma.lead.count({
        where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      }),
      prisma.lead.groupBy({
        by: ["currentStageId"],
        _count: { id: true },
        where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      }),
      prisma.lead.groupBy({
        by: ["sourceId"],
        _count: { id: true },
        where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      }),
      prisma.lead.groupBy({
        by: ["assignedUserId"],
        _count: { id: true },
        where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      }),
      prisma.task.count({
        where: {
          dueAt: { lt: new Date() },
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
      }),
    ]);

    // Get stage/source/user names
    const [allStages, allSources, allUsers] = await Promise.all([
      prisma.leadStage.findMany(),
      prisma.leadSource.findMany(),
      prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
    ]);

    const wonStage = allStages.find((s) => s.isWon);
    const lostStage = allStages.find((s) => s.isLost);

    const wonCount = wonStage
      ? stages.find((s) => s.currentStageId === wonStage.id)?._count.id || 0
      : 0;
    const lostCount = lostStage
      ? stages.find((s) => s.currentStageId === lostStage.id)?._count.id || 0
      : 0;
    const closeRate = totalLeads > 0 ? ((wonCount / totalLeads) * 100).toFixed(1) : "0";

    const overdueFollowUps = await prisma.lead.count({
      where: {
        nextFollowUpAt: { lt: new Date() },
        currentStage: { isClosed: false },
      },
    });

    return NextResponse.json({
      totalLeads,
      wonCount,
      lostCount,
      closeRate,
      overdueFollowUps,
      overdueTasks,
      byStage: stages.map((s) => ({
        stageId: s.currentStageId,
        stageName: allStages.find((st) => st.id === s.currentStageId)?.name || "Unknown",
        count: s._count.id,
      })),
      bySource: sources.map((s) => ({
        sourceId: s.sourceId,
        sourceName: allSources.find((sr) => sr.id === s.sourceId)?.name || "Unknown",
        count: s._count.id,
      })),
      byRep: reps.map((r) => {
        const user = allUsers.find((u) => u.id === r.assignedUserId);
        return {
          userId: r.assignedUserId,
          userName: user ? `${user.firstName} ${user.lastName}` : "Unassigned",
          count: r._count.id,
        };
      }),
    });
  }

  if (type === "conversions") {
    const allStages = await prisma.leadStage.findMany({ orderBy: { stageOrder: "asc" } });

    const stageCounts = await Promise.all(
      allStages.map(async (stage) => {
        const count = await prisma.leadStageHistory.count({
          where: {
            toStageId: stage.id,
            ...(hasDateFilter ? { changedAt: dateFilter } : {}),
          },
        });
        return { stageName: stage.name, stageOrder: stage.stageOrder, count };
      })
    );

    const getCount = (name: string) =>
      stageCounts.find((s) => s.stageName === name)?.count || 0;

    const total = await prisma.lead.count({
      where: hasDateFilter ? { createdAt: dateFilter } : undefined,
    });

    const contacted = getCount("Contacted");
    const appointed = getCount("Appointment Scheduled");
    const estimated = getCount("Estimate Sent");
    const won = getCount("Won");

    return NextResponse.json({
      stageCounts,
      funnelMetrics: {
        leadToContact: total > 0 ? ((contacted / total) * 100).toFixed(1) : "0",
        contactToAppointment: contacted > 0 ? ((appointed / contacted) * 100).toFixed(1) : "0",
        appointmentToEstimate: appointed > 0 ? ((estimated / appointed) * 100).toFixed(1) : "0",
        estimateToWon: estimated > 0 ? ((won / estimated) * 100).toFixed(1) : "0",
        leadToWon: total > 0 ? ((won / total) * 100).toFixed(1) : "0",
      },
    });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
}
