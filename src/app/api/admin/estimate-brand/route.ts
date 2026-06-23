import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { ensureBrandRow, KNU_BRAND_ID } from "@/lib/pdf/brand";

// Brand used on non-roofing (Drywall / Interior Renovation / Windows & Doors)
// estimate PDFs. Per business rule it differs from the roofing (NewCoast) brand
// only by company name + logo; all other letterhead is inherited at render time
// (see src/lib/pdf/brand.ts → loadEstimateBrand).
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const brand = await ensureBrandRow(KNU_BRAND_ID, "Knu Construction");
  return NextResponse.json(brand);
}

const updateSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
});

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return forbidden();
  }

  const result = await validateBody(request, updateSchema);
  if (!result.ok) return result.response;

  await ensureBrandRow(KNU_BRAND_ID, "Knu Construction");
  const updated = await prisma.roofingBrand.update({
    where: { id: KNU_BRAND_ID },
    data: { companyName: result.data.companyName },
  });
  return NextResponse.json(updated);
}
