import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import { getOrEnrich } from "@/lib/services/canvassing/repository";

// Full scored detail + Canvasser One-Screen Summary for one property. The
// opening script is personalized to the signed-in canvasser unless ?canvasser=
// overrides it. Served from cache; refreshed from Zylow only when stale/missing.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reapiId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { reapiId } = await params;
  const override = request.nextUrl.searchParams.get("canvasser");
  const canvasserName =
    override?.trim() ||
    `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() ||
    null;

  try {
    const detail = await getOrEnrich(reapiId, { canvasserName });
    if (!detail) {
      return NextResponse.json(
        { error: "We don't have this property" },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (err) {
    return zylowErrorResponse(err, {
      route: "canvassing/properties/detail",
      reapiId,
    });
  }
}
