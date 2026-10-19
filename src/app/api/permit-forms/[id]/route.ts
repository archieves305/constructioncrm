import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { validateBody } from "@/lib/validation/body";
import { loadTemplate, mappingIsStale, runMapping, updateTemplateMeta } from "@/lib/permit-intel/forms";
import { templateMetaPatchSchema } from "@/lib/permit-intel/form-validation";

type Context = { params: Promise<{ id: string }> };

/** A template with its field inventory and mapping. A mapping a restart cut off is started again. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  const t = await loadTemplate(id);
  if (!t) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (mappingIsStale(t)) after(() => runMapping(id, null));
  return NextResponse.json(t);
}

/** Name, where it is used, notes. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, templateMetaPatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateTemplateMeta(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
