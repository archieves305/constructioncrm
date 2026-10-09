import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canApproveTakeoff, TAKEOFF_APPROVE_DENIED } from "@/lib/takeoff/access";
import { guardMeasurement } from "@/lib/takeoff/route-guards";
import { deleteMeasurement, updateMeasurement } from "@/lib/takeoff/takeoff-service";
import { patchMeasurementSchema } from "@/lib/takeoff/validation";

type Params = { params: Promise<{ id: string }> };

/** Edit geometry, label, type or review state. Approving is for office roles. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardMeasurement(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, patchMeasurementSchema);
  if (!body.ok) return body.response;
  if (body.data.reviewStatus === "APPROVED" && !canApproveTakeoff(session.user.role)) return NextResponse.json({ error: TAKEOFF_APPROVE_DENIED }, { status: 403 });
  const result = await updateMeasurement(id, body.data, session.user.id);
  if (!result) return NextResponse.json({ error: "Measurement not found" }, { status: 404 });
  if ("error" in result) return badRequest(result.error);
  return NextResponse.json(result);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardMeasurement(session.user, id, "write");
  if (denied) return denied;
  await deleteMeasurement(id, session.user.id);
  return NextResponse.json({ ok: true });
}
