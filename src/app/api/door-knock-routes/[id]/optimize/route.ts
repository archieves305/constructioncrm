import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { optimizeRouteSchema } from "@/lib/validators/door-knock";
import { nearestNeighborTSP } from "@/lib/utils/route-optimizer";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  const parsed = optimizeRouteSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;

  // Fetch route with stops and lead coordinates
  // Note: We need to get lat/lng from leads. For now, we'll assume they're not in the schema
  // In a real implementation, you'd need to add lat/lng to the Lead model or fetch from geocoding
  const route = await prisma.doorKnockRoute.findUnique({
    where: { id: params.id },
    include: {
      stops: {
        include: {
          lead: {
            select: {
              id: true,
              propertyAddress1: true,
              city: true,
              state: true,
              zipCode: true,
            },
          },
        },
      },
    },
  });

  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  // For now, we'll create stops with null lat/lng as placeholders
  // In production, you'd geocode the addresses or store coordinates
  const stops = route.stops.map((stop) => ({
    id: stop.id,
    lat: null as number | null, // TODO: Get from geocoded lead address
    lng: null as number | null, // TODO: Get from geocoded lead address
    sortOrder: stop.sortOrder,
  }));

  // Run TSP optimization
  const result = nearestNeighborTSP(stops, {
    startLat: input.startLat,
    startLng: input.startLng,
    returnToStart: input.roundTrip,
  });

  // Update stop sort orders in database
  await prisma.$transaction(
    result.orderedStops.map((stop) =>
      prisma.doorKnockRouteStop.update({
        where: { id: stop.id },
        data: { sortOrder: stop.sortOrder },
      })
    )
  );

  // Update route with start coordinates and distance
  const updatedRoute = await prisma.doorKnockRoute.update({
    where: { id: params.id },
    data: {
      startLatitude: input.startLat,
      startLongitude: input.startLng,
      startLabel: input.startLabel,
      isRoundTrip: input.roundTrip,
      totalDistanceMiles: result.totalMiles,
    },
    include: {
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
            },
          },
        },
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });

  return NextResponse.json(updatedRoute);
}
