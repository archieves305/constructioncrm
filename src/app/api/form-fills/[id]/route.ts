import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { deleteFill, getFill, setOverride } from "@/lib/permit-intel/fills";
import { fillInScope } from "@/lib/permit-intel/fill-scope";
import { fillOverrideSchema } from "@/lib/permit-intel/form-validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await fillInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  try {
    return NextResponse.json(await getFill(id));
  } catch (err) {
    return errorResponse(err);
  }
}

/** A person's value for one field (null puts the record's value back). */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await fillInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, fillOverrideSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await setOverride(id, v.data.field, v.data.value, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Remove a draft (and its output files, unless one was sent in a package). */
export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await fillInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  try {
    await deleteFill(id, actorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
