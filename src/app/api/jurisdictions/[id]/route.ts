import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { updateJurisdiction } from "@/lib/permit-intel/service";
import { jurisdictionPatchSchema as schema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };



/** Edit or switch off a jurisdiction. A rename carries into the permits' text. Never deleted: permits point at it. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateJurisdiction(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
