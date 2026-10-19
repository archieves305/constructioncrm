import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canWriteProduction } from "@/lib/access/roles";
import { canConfirmCorrections } from "@/lib/permit-intel/access";
import { confirmNotice } from "@/lib/permit-intel/corrections";
import { actorOf, errorResponse, noticeInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** A person confirms the items: they become tasks, the review cycle and the permit move to corrections. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await noticeInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role) || !canConfirmCorrections(session.user, scope.permit)) return forbidden();
  try {
    return NextResponse.json(await confirmNotice(id, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
