import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { loadPermitMetrics } from "@/lib/permit-intel/metrics-load";

/** Permit Center's metrics strip: each tile with the permits it counts. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "CREW_LEAD") return forbidden();
  return NextResponse.json(await loadPermitMetrics(session.user));
}
