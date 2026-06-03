import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const days = parseInt(searchParams.get("days") || "30");

  // Validate days parameter
  if (days < 1 || days > 90) {
    return NextResponse.json(
      { error: "Days must be between 1 and 90" },
      { status: 400 }
    );
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get all knocks in the time period
  const knocks = await prisma.propertyDoorKnock.findMany({
    where: {
      knockedAt: { gte: since },
      isDeleted: false,
    },
    include: {
      knockedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Get active routes
  const activeRoutes = await prisma.doorKnockRoute.findMany({
    where: {
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      isDeleted: false,
    },
    select: {
      assignedToUserId: true,
    },
  });

  // Group knocks by user
  const userStats = new Map<
    string,
    {
      userId: string;
      userName: string;
      total: number;
      properties: Set<string>;
      daysActive: Set<string>;
      outcomes: Record<string, number>;
      lastKnockAt: Date | null;
    }
  >();

  for (const knock of knocks) {
    const userId = knock.knockedByUserId;
    const userName = knock.knockedBy
      ? `${knock.knockedBy.firstName} ${knock.knockedBy.lastName}`
      : "Unknown";

    if (!userStats.has(userId)) {
      userStats.set(userId, {
        userId,
        userName,
        total: 0,
        properties: new Set(),
        daysActive: new Set(),
        outcomes: {},
        lastKnockAt: null,
      });
    }

    const stats = userStats.get(userId)!;
    stats.total++;
    stats.properties.add(knock.prospectId);
    stats.daysActive.add(knock.knockedAt.toISOString().split("T")[0]);
    stats.outcomes[knock.outcome] = (stats.outcomes[knock.outcome] || 0) + 1;

    if (!stats.lastKnockAt || knock.knockedAt > stats.lastKnockAt) {
      stats.lastKnockAt = knock.knockedAt;
    }
  }

  // Count assigned routes per user
  const routeCounts = new Map<string, number>();
  for (const route of activeRoutes) {
    if (route.assignedToUserId) {
      routeCounts.set(
        route.assignedToUserId,
        (routeCounts.get(route.assignedToUserId) || 0) + 1
      );
    }
  }

  // Build response rows
  const rows = Array.from(userStats.values()).map((stats) => {
    // Calculate conversation percentage
    // Conversations = spoke with owner + spoke with occupant + hostile
    const conversations =
      (stats.outcomes["SPOKE_WITH_OWNER"] || 0) +
      (stats.outcomes["SPOKE_WITH_OCCUPANT"] || 0) +
      (stats.outcomes["HOSTILE"] || 0);
    const convPct = stats.total > 0 ? Math.round((conversations / stats.total) * 1000) / 10 : 0;

    return {
      userId: stats.userId,
      userName: stats.userName,
      total: stats.total,
      properties: stats.properties.size,
      daysActive: stats.daysActive.size,
      noAnswer: stats.outcomes["NO_ANSWER"] || 0,
      spokeWithOwner: stats.outcomes["SPOKE_WITH_OWNER"] || 0,
      spokeWithOccupant: stats.outcomes["SPOKE_WITH_OCCUPANT"] || 0,
      leftDoorHanger: stats.outcomes["LEFT_DOOR_HANGER"] || 0,
      vacant: stats.outcomes["VACANT"] || 0,
      hostile: stats.outcomes["HOSTILE"] || 0,
      gateBlocked: stats.outcomes["GATE_BLOCKED"] || 0,
      other: stats.outcomes["OTHER"] || 0,
      assignedRoutes: routeCounts.get(stats.userId) || 0,
      lastKnockAt: stats.lastKnockAt,
      convPct,
    };
  });

  // Sort by total knocks descending
  rows.sort((a, b) => b.total - a.total);

  // Calculate totals
  const totals = {
    total: knocks.length,
    activeClosers: userStats.size,
    conversations: rows.reduce(
      (sum, row) => sum + row.spokeWithOwner + row.spokeWithOccupant + row.hostile,
      0
    ),
    noContact: rows.reduce(
      (sum, row) => sum + row.noAnswer + row.vacant + row.gateBlocked,
      0
    ),
  };

  return NextResponse.json({ totals, rows });
}
