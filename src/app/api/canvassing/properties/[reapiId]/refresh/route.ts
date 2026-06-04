import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import { getOrEnrich } from "@/lib/services/canvassing/repository";

// Manual refresh — bypasses the cache TTL and re-pulls from Zylow (spec §11).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reapiId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { reapiId } = await params;
  const canvasserName =
    `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() || null;

  try {
    const detail = await getOrEnrich(reapiId, { forceRefresh: true, canvasserName });
    if (!detail) {
      return NextResponse.json(
        { error: "We don't have this property" },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (err) {
    return zylowErrorResponse(err, {
      route: "canvassing/properties/refresh",
      reapiId,
    });
  }
}
