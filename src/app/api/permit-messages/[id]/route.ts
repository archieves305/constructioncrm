import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { discardMessage, updateMessage } from "@/lib/permit-intel/messages";
import { messagePatchSchema } from "@/lib/permit-intel/correction-validation";
import { errorResponse, mailActorOf, messageInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Edit a draft. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await messageInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, messagePatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateMessage(id, v.data));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Discard a draft (kept, out of the list). */
export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await messageInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    await discardMessage(id, mailActorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
