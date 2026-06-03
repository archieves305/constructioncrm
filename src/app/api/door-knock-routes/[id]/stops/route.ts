import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { addStopsToRouteSchema } from "@/lib/validators/door-knock";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  const body = await request.json();
  const parsed = addStopsToRouteSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const { prospectIds } = parsed.data;

  // Get current max sort order for this route
  const maxSortOrder = await prisma.doorKnockRouteStop.aggregate({
    where: { routeId: id },
    _max: { sortOrder: true },
  });

  let nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  // Create stops, handling duplicates via UNIQUE constraint
  const stops = [];
  for (const prospectId of prospectIds) {
    try {
      const stop = await prisma.doorKnockRouteStop.create({
        data: {
          routeId: id,
          prospectId,
          sortOrder: nextSortOrder++,
        },
        include: {
          prospect: {
            select: {
              id: true,
              ownerName: true,
              propertyAddress1: true,
              city: true,
              state: true,
              zipCode: true,
            },
          },
        },
      });
      stops.push(stop);
    } catch (error: any) {
      // Skip if duplicate (unique constraint violation)
      if (error.code === "P2002") {
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json(stops, { status: 201 });
}
