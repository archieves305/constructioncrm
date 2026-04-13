import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const userId = searchParams.get("userId");

  const where: Record<string, unknown> = {};
  if (userId) where.assignedUserId = userId;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, Date>).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as Record<string, Date>).lte = new Date(dateTo);
  }

  const metrics = await prisma.leadResponseMetric.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // SLA buckets
  const slaBuckets = { under1: 0, under5: 0, under10: 0, under15: 0, over15: 0, noResponse: 0 };
  let totalResponseTime = 0;
  let responseCount = 0;

  for (const m of metrics) {
    if (m.responseTimeSeconds) {
      responseCount++;
      totalResponseTime += m.responseTimeSeconds;
      const mins = m.responseTimeSeconds / 60;
      if (mins <= 1) slaBuckets.under1++;
      else if (mins <= 5) slaBuckets.under5++;
      else if (mins <= 10) slaBuckets.under10++;
      else if (mins <= 15) slaBuckets.under15++;
      else slaBuckets.over15++;
    } else {
      slaBuckets.noResponse++;
    }
  }

  // Per-user aggregation
  const userMap = new Map<string, { total: number; totalTime: number; responded: number }>();
  for (const m of metrics) {
    const uid = m.assignedUserId || "unassigned";
    const existing = userMap.get(uid) || { total: 0, totalTime: 0, responded: 0 };
    existing.total++;
    if (m.responseTimeSeconds) {
      existing.responded++;
      existing.totalTime += m.responseTimeSeconds;
    }
    userMap.set(uid, existing);
  }

  const users = await prisma.user.findMany({
    select: { id: true, firstName: true, lastName: true },
  });
  const userLookup = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  const byUser = Array.from(userMap.entries()).map(([uid, data]) => ({
    userId: uid,
    userName: userLookup.get(uid) || "Unassigned",
    totalLeads: data.total,
    responded: data.responded,
    avgResponseSeconds: data.responded > 0 ? Math.round(data.totalTime / data.responded) : null,
  }));

  return NextResponse.json({
    totalLeads: metrics.length,
    avgResponseSeconds: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : null,
    slaBuckets,
    byUser,
    metrics: metrics.slice(0, 50),
  });
}
