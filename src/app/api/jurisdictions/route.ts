import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { createJurisdiction, listJurisdictions } from "@/lib/permit-intel/service";
import { jurisdictionSchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

/** The building departments KNU files with. Everyone signed in reads the list (it feeds the permit form); ADMIN / MANAGER change it. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const all = request.nextUrl.searchParams.get("all") === "1" && canManagePermitSettings(session.user.role);
  return NextResponse.json(await listJurisdictions({ includeInactive: all }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const v = await validateBody(request, jurisdictionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createJurisdiction(v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
