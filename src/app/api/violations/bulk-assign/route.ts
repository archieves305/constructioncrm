import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { bulkAssignSchema } from "@/lib/validators/violation";
import { canAssignCase } from "@/lib/violations/access";
import { assignCases } from "@/lib/violations/update";
import { violationErrorResponse } from "@/lib/violations/route-helpers";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAssignCase(session.user.role)) return forbidden();
  const parsed = await validateBody(request, bulkAssignSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const updated = await assignCases(parsed.data.caseIds, parsed.data.caseManagerId, session.user);
    return NextResponse.json({ updated, requested: parsed.data.caseIds.length });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
