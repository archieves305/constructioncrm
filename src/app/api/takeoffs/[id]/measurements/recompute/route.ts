import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardTakeoff } from "@/lib/takeoff/route-guards";
import { recomputeMeasurements } from "@/lib/takeoff/takeoff-service";

/** Re-measure every length and area with its sheet's current calibration (an explicit action, never automatic). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "write");
  if (denied) return denied;
  return NextResponse.json(await recomputeMeasurements(id, session.user.id));
}
