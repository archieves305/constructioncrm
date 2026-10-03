import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

import { prisma } from "@/lib/db/prisma";
import { updateMaterial } from "@/lib/roofing/price-book";
import { updateMaterialSchema } from "@/lib/roofing/price-book-validation";
import type { RoofType } from "@/lib/roofing/types";

/** Edit a material, switch it off, or make it the takeoff's choice. A material is never deleted: estimates will point at it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  const { id } = await params;
  const body = await validateBody(request, updateMaterialSchema);
  if (!body.ok) return body.response;
  if (body.data.vendorId && !(await prisma.vendor.findUnique({ where: { id: body.data.vendorId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 400 });
  }
  const { roofType, ...rest } = body.data;
  const updated = await updateMaterial(id, { ...rest, ...(roofType !== undefined ? { roofType: roofType as RoofType | null } : {}) }, session.user.id);
  return updated ? NextResponse.json(updated) : NextResponse.json({ error: "Material not found" }, { status: 404 });
}
