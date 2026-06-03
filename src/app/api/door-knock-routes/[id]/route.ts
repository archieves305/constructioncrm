import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { updateDoorKnockRouteSchema } from "@/lib/validators/door-knock";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const route = await prisma.doorKnockRoute.findUnique({
    where: {
      id: params.id,
      isDeleted: false,
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
      stops: {
        include: {
          lead: {
            select: {
              id: true,
              fullName: true,
              propertyAddress1: true,
              city: true,
              state: true,
              zipCode: true,
              primaryPhone: true,
            },
          },
          knock: {
            select: {
              id: true,
              outcome: true,
              knockedAt: true,
            },
          },
        },
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });

  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  return NextResponse.json(route);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = updateDoorKnockRouteSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;

  const route = await prisma.doorKnockRoute.update({
    where: { id: params.id },
    data: {
      name: input.name,
      description: input.description,
      status: input.status,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
      assignedToUserId: input.assignedToUserId,
    },
    include: {
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return NextResponse.json(route);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  // Soft delete
  const route = await prisma.doorKnockRoute.update({
    where: { id: params.id },
    data: {
      isDeleted: true,
    },
  });

  return NextResponse.json(route);
}
