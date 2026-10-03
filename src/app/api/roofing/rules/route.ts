import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

import { listRules } from "@/lib/roofing/price-book";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  return NextResponse.json(await listRules());
}
