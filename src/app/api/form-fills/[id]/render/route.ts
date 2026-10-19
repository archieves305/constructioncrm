import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canWriteProduction } from "@/lib/access/roles";
import { renderFill } from "@/lib/permit-intel/fills";
import { fillInScope } from "@/lib/permit-intel/fill-scope";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Write the filled PDF (editable and flattened) onto the permit's documents. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await fillInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    return NextResponse.json(await renderFill(id, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
