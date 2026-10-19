import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { listLessons } from "@/lib/permit-intel/knowledge";

/** The lessons learned from accepted corrections (Admin → Permits → Knowledge). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  return NextResponse.json(await listLessons());
}
