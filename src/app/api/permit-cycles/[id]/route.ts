import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { recordCycleOutcome } from "@/lib/permit-intel/service";
import { cycleOutcomeSchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The building department's answer to a review cycle; the permit's status follows. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const cycle = await prisma.permitReviewCycle.findUnique({ where: { id }, select: { permitId: true } });
  if (!cycle) return NextResponse.json({ error: "Review cycle not found" }, { status: 404 });
  const scope = await permitInScope(session.user, cycle.permitId, "write");
  if (scope.denied) return scope.denied;
  if (!canSubmitPermit(session.user, scope.permit)) return forbidden();
  const v = await validateBody(request, cycleOutcomeSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await recordCycleOutcome(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
