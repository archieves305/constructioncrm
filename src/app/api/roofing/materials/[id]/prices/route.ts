import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

import { addPrice } from "@/lib/roofing/price-book";
import { addPriceSchema } from "@/lib/roofing/price-book-validation";

/** A new price from a date. Earlier prices stay as the history. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  const { id } = await params;
  const body = await validateBody(request, addPriceSchema);
  if (!body.ok) return body.response;
  const updated = await addPrice(id, { unitCost: body.data.unitCost, day: body.data.effectiveDate, note: body.data.note }, session.user.id);
  return updated ? NextResponse.json(updated, { status: 201 }) : NextResponse.json({ error: "Material not found" }, { status: 404 });
}
