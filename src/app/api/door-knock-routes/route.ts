import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createDoorKnockRouteSchema } from "@/lib/validators/door-knock";
import { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assigned_to");
  const createdBy = searchParams.get("created_by");
  const limit = searchParams.get("limit");

  const where: Prisma.DoorKnockRouteWhereInput = {
    isDeleted: false,
  };

  if (status) {
    where.status = status as any;
  }

  if (assignedTo === "me") {
    where.assignedToUserId = session.user.id;
  } else if (assignedTo) {
    where.assignedToUserId = assignedTo;
  }

  if (createdBy === "me") {
    where.createdByUserId = session.user.id;
  } else if (createdBy) {
    where.createdByUserId = createdBy;
  }

  const routes = await prisma.doorKnockRoute.findMany({
    where,
    include: {
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      stops: {
        select: {
          id: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit ? parseInt(limit) : undefined,
  });

  // Add stop counts to each route
  const routesWithCounts = routes.map((route) => ({
    ...route,
    totalStops: route.stops.length,
    visitedStops: route.stops.filter((s) => s.status === "VISITED").length,
    skippedStops: route.stops.filter((s) => s.status === "SKIPPED").length,
    pendingStops: route.stops.filter((s) => s.status === "PENDING").length,
  }));

  return NextResponse.json(routesWithCounts);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = createDoorKnockRouteSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;

  const route = await prisma.doorKnockRoute.create({
    data: {
      name: input.name,
      description: input.description,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
      createdByUserId: session.user.id,
      assignedToUserId: input.assignedToUserId || session.user.id,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return NextResponse.json(route, { status: 201 });
}
