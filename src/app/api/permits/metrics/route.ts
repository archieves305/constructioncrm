import { isCrewRole } from "@/lib/access/roles";
import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { loadPermitMetrics } from "@/lib/permit-intel/metrics-load";

/** Permit Center's metrics strip: each tile with the permits it counts. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (isCrewRole(session.user.role)) return forbidden();
  return NextResponse.json(await loadPermitMetrics(session.user));
}
