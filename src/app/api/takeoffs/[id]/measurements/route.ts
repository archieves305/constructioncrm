import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardTakeoff } from "@/lib/takeoff/route-guards";
import { createMeasurement, listMeasurements } from "@/lib/takeoff/takeoff-service";
import { createMeasurementSchema } from "@/lib/takeoff/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "read");
  if (denied) return denied;
  return NextResponse.json(await listMeasurements(id));
}

/** A measurement drawn by a person. The value is computed here from the sheet's calibration. */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, createMeasurementSchema);
  if (!body.ok) return body.response;
  const result = await createMeasurement(id, body.data, session.user.id);
  if (!result) return NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
  if ("error" in result) return badRequest(result.error);
  return NextResponse.json(result, { status: 201 });
}
