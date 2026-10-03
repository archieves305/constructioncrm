import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

import { prisma } from "@/lib/db/prisma";
import { createMaterial, listMaterials } from "@/lib/roofing/price-book";
import { createMaterialSchema } from "@/lib/roofing/price-book-validation";
import type { RoofType } from "@/lib/roofing/types";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  return NextResponse.json(await listMaterials());
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  const body = await validateBody(request, createMaterialSchema);
  if (!body.ok) return body.response;
  if (body.data.vendorId && !(await prisma.vendor.findUnique({ where: { id: body.data.vendorId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 400 });
  }
  const created = await createMaterial({ ...body.data, roofType: (body.data.roofType ?? null) as RoofType | null }, session.user.id);
  return NextResponse.json(created, { status: 201 });
}
