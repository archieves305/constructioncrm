import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { createRequirement, listRequirements } from "@/lib/permit-intel/service";
import { requirementSchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

/** The documents checklist: what each jurisdiction × permit type asks for. ADMIN / MANAGER. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const j = request.nextUrl.searchParams.get("jurisdictionId");
  return NextResponse.json(await listRequirements(j === null ? {} : { jurisdictionId: j === "all" ? null : j }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const v = await validateBody(request, requirementSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createRequirement(v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
