import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { loadTemplate, saveMappings } from "@/lib/permit-intel/forms";
import { fieldMapsSchema } from "@/lib/permit-intel/form-validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** A person's mapping for some fields of a draft. */
export async function PUT(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, fieldMapsSchema);
  if (!v.ok) return v.response;
  try {
    await saveMappings(id, v.data.fields, actorOf(session.user));
    return NextResponse.json(await loadTemplate(id));
  } catch (err) {
    return errorResponse(err);
  }
}
