import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canAdminPartners } from "@/lib/partners/access";
import { loadBdSummary } from "@/lib/partners/scorecard-load";

/** The dashboard's Business Development strip (ADMIN / MANAGER). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: "Not available for your role" }, { status: 403 });
  return NextResponse.json(await loadBdSummary());
}
