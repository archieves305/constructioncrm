import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { inspectionPatchSchema } from "@/lib/validators/violation";
import { updateInspection } from "@/lib/violations/inspections";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; inspectionId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, inspectionId } = await params;
  const parsed = await validateBody(request, inspectionPatchSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canRecordInspection);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await updateInspection(id, inspectionId, parsed.data, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
