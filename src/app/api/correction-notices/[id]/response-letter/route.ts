import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canWriteProduction } from "@/lib/access/roles";
import { generateResponseLetter } from "@/lib/permit-intel/response-letter";
import { actorOf, errorResponse, noticeInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Write the point-by-point response letter and file it on the permit. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await noticeInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    return NextResponse.json(await generateResponseLetter(id, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
