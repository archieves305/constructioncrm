import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { addStopsToRouteSchema } from "@/lib/validators/door-knock";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = addStopsToRouteSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const { leadIds } = parsed.data;

  // Get current max sort order for this route
  const maxSortOrder = await prisma.doorKnockRouteStop.aggregate({
    where: { routeId: params.id },
    _max: { sortOrder: true },
  });

  let nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  // Create stops, handling duplicates via UNIQUE constraint
  const stops = [];
  for (const leadId of leadIds) {
    try {
      const stop = await prisma.doorKnockRouteStop.create({
        data: {
          routeId: params.id,
          leadId,
          sortOrder: nextSortOrder++,
        },
        include: {
          lead: {
            select: {
              id: true,
              fullName: true,
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
