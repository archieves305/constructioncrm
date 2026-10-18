import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { deleteNotice, updateNotice } from "@/lib/permit-intel/corrections";
import { noticePatchSchema } from "@/lib/permit-intel/correction-validation";
import { actorOf, errorResponse, noticeInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await noticeInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, noticePatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateNotice(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Remove a notice that was never confirmed (its file stays on the permit). */
export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await noticeInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    await deleteNotice(id, actorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
