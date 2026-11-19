import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { findProjectMatches } from "@/lib/bids/project";

/** Projects a new one may duplicate (PlanHub reference, address, name) — for the create form. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const matches = await findProjectMatches({ platformRef: sp.get("platformRef"), address1: sp.get("address1"), zipCode: sp.get("zipCode"), name: sp.get("name") });
  return NextResponse.json({ matches });
}
