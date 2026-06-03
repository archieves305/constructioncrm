import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import { getCachedOrFetch } from "@/lib/services/zylow/cache";

// A single property by REAPI id, served from the local cache (refreshed from
// Zylow on a 24h TTL). Pass ?refresh=true to bypass the cache.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

  try {
    const property = await getCachedOrFetch(id, forceRefresh);
    if (!property) {
      return NextResponse.json(
        { error: "We don't have this property" },
        { status: 404 },
      );
    }
    return NextResponse.json(property);
  } catch (err) {
    return zylowErrorResponse(err, { route: "zylow/property", reapiId: id });
  }
}
