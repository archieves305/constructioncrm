import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { createFill, listFills } from "@/lib/permit-intel/fills";
import { fillCreateSchema } from "@/lib/permit-intel/form-validation";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The permit's filled forms and the published forms that apply to it. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  try {
    const canEdit = canWriteProduction(session.user.role);
    return NextResponse.json({ ...(await listFills(id)), permissions: { canEdit, canFinalize: canEdit && canSubmitPermit(session.user, scope.permit) } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Start filling a published form for this permit. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, fillCreateSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createFill(id, v.data.templateId, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
