import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { updateRouteStopSchema } from "@/lib/validators/door-knock";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id, stopId } = await params;

  const body = await request.json();
  const parsed = updateRouteStopSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;

  // Scope the update to this route so a stopId from another route can't be
  // mutated through this path.
  const { count } = await prisma.doorKnockRouteStop.updateMany({
    where: { id: stopId, routeId: id },
    data: {
      status: input.status,
      notes: input.notes,
      sortOrder: input.sortOrder,
      knockId: input.knockId,
    },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Stop not found" }, { status: 404 });
  }

  const stop = await prisma.doorKnockRouteStop.findUnique({
    where: { id: stopId },
    include: {
      prospect: {
        select: {
          id: true,
          ownerName: true,
          propertyAddress1: true,
          city: true,
          state: true,
          zipCode: true,
          latitude: true,
          longitude: true,
        },
      },
      knock: {
        select: { id: true, outcome: true, knockedAt: true },
      },
    },
  });

  return NextResponse.json(stop);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id, stopId } = await params;

  const { count } = await prisma.doorKnockRouteStop.deleteMany({
    where: { id: stopId, routeId: id },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Stop not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
