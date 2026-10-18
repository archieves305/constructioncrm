import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { linkItemFile, unlinkItemFile } from "@/lib/permit-intel/corrections";
import { itemFileSchema } from "@/lib/permit-intel/correction-validation";
import { actorOf, errorResponse, itemInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Link a revised document (already one of the permit's files) to the item it answers. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await itemInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, itemFileSchema);
  if (!v.ok) return v.response;
  try {
    await linkItemFile(id, v.data.fileId, actorOf(session.user));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const fileId = request.nextUrl.searchParams.get("fileId");
  if (!fileId) return badRequest("fileId is required");
  const scope = await itemInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    await unlinkItemFile(id, fileId, actorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
