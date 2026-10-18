import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { addItem } from "@/lib/permit-intel/corrections";
import { itemCreateSchema } from "@/lib/permit-intel/correction-validation";
import { actorOf, errorResponse, noticeInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** A correction the reading missed, typed by a person. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await noticeInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, itemCreateSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addItem(id, v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
