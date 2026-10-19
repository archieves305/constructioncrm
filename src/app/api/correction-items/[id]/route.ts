import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { deleteItem, updateItem } from "@/lib/permit-intel/corrections";
import { itemPatchSchema } from "@/lib/permit-intel/correction-validation";
import { actorOf, errorResponse, itemInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await itemInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, itemPatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateItem(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** A proposed item the reading got wrong (letterhead, boilerplate, a duplicate). */
export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await itemInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    await deleteItem(id, actorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
