import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canWriteProduction } from "@/lib/access/roles";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { finalizeFill } from "@/lib/permit-intel/fills";
import { fillInScope } from "@/lib/permit-intel/fill-scope";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** A person finalises the form: written once more, then kept as it is. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await fillInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role) || !canSubmitPermit(session.user, scope.permit)) return forbidden();
  try {
    return NextResponse.json(await finalizeFill(id, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
