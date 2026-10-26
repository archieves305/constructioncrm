import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardTakeoff } from "@/lib/takeoff/route-guards";
import { roofMeasurementFromTakeoff } from "@/lib/takeoff/takeoff-service";
import { roofMeasurementFromTakeoffSchema } from "@/lib/takeoff/validation";
import { validateBody } from "@/lib/validation/body";

/**
 * "Use for an estimate": a roofing takeoff's reviewed rows on the chosen
 * sheets become a roof measurement on the lead, which the estimate builder's
 * "Add roofing section from measurement" prices like a Roofr report.
 * `?preview=1` writes nothing. Edit role, on the takeoff's lead.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, roofMeasurementFromTakeoffSchema);
  if (!body.ok) return body.response;
  const write = request.nextUrl.searchParams.get("preview") !== "1";
  const result = await roofMeasurementFromTakeoff(id, body.data, session.user.id, write);
  if (!result) return NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: write ? 201 : 200 });
}
