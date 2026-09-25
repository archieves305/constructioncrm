import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { hearingPatchSchema } from "@/lib/validators/violation";
import { updateHearing } from "@/lib/violations/hearings";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; hearingId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, hearingId } = await params;
  const parsed = await validateBody(request, hearingPatchSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canRecordHearing);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await updateHearing(id, hearingId, parsed.data, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
