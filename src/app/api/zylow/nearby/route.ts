import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { zylowClient } from "@/lib/services/zylow/client";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import { upsertMany } from "@/lib/services/zylow/cache";
import { nearbyQuerySchema } from "@/lib/validators/zylow";

// Closest-first properties around a GPS point. The browser sends the device's
// lat/lng; the API key stays here, server-side. Results are mirrored into the
// local cache so repeat views and the route optimizer can reuse coordinates.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = nearbyQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }
  const { lat, lng, radius_miles, limit } = parsed.data;

  try {
    const data = await zylowClient.getNearby({
      lat,
      lng,
      radiusMiles: radius_miles,
      limit,
    });
    // Best-effort cache warm; never fail the response if mirroring hiccups.
    upsertMany(data.results).catch(() => {});
    return NextResponse.json(data);
  } catch (err) {
    return zylowErrorResponse(err, { route: "zylow/nearby", lat, lng });
  }
}
