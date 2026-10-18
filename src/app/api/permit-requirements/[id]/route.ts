import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { updateRequirement } from "@/lib/permit-intel/service";
import { requirementPatchSchema as schema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };



export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateRequirement(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
