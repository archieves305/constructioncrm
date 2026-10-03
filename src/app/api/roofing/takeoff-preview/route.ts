import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

import { previewTakeoff } from "@/lib/roofing/price-book";
import { takeoffPreviewSchema } from "@/lib/roofing/price-book-validation";
import type { RoofType } from "@/lib/roofing/types";

/** The material list and cost a stored measurement gives with today's rules and prices. Writes nothing. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  const body = await validateBody(request, takeoffPreviewSchema);
  if (!body.ok) return body.response;
  const result = await previewTakeoff(body.data.measurementId, body.data.roofType as RoofType, { wasteFactorPct: body.data.wastePct, battenInstall: body.data.battenInstall });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Measurement not found" }, { status: 404 });
}
