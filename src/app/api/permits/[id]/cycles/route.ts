import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { recordManualCycle } from "@/lib/permit-intel/service";
import { manualCycleSchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Record a submission made outside the CRM (no package): it opens the next review cycle. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canSubmitPermit(session.user, scope.permit)) return forbidden();
  const v = await validateBody(request, manualCycleSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await recordManualCycle(id, v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
