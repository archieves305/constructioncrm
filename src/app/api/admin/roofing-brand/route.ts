import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  getSession,
  unauthorized,
  forbidden,
} from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";

async function ensureBrand() {
  let brand = await prisma.roofingBrand.findUnique({ where: { id: "default" } });
  if (!brand) {
    brand = await prisma.roofingBrand.create({
      data: { id: "default", companyName: "NewCoast Roofing" },
    });
  }
  return brand;
}

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const brand = await ensureBrand();
  return NextResponse.json(brand);
}

const brandUpdateSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(20).nullish(),
  zip: z.string().trim().max(20).nullish(),
  phone: z.string().trim().max(60).nullish(),
  email: z.string().trim().max(200).nullish(),
  website: z.string().trim().max(200).nullish(),
  roofingLicense: z.string().trim().max(60).nullish(),
  gcLicense: z.string().trim().max(60).nullish(),
  defaultExpirationDays: z.number().int().min(1).max(365),
  defaultUnderlaymentType: z.string().trim().max(500).nullish(),
  defaultPlywoodSheetsIncluded: z.number().int().min(0).max(500),
  defaultAdditionalPlywoodPrice: z.number().nonnegative().max(10000),
  defaultWorkmanshipWarrantyYears: z.number().int().min(0).max(99),
  defaultManufacturerWarranty: z.string().trim().max(500).nullish(),
  paymentDepositPercent: z.number().min(0).max(100),
  paymentProgressPercent: z.number().min(0).max(100),
  paymentFinalPercent: z.number().min(0).max(100),
});

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return forbidden();
  }

  const result = await validateBody(request, brandUpdateSchema);
  if (!result.ok) return result.response;
  const data = result.data;

  // Sanity check that the three percentages sum to 100 (within rounding).
  const sum =
    data.paymentDepositPercent +
    data.paymentProgressPercent +
    data.paymentFinalPercent;
  if (Math.abs(sum - 100) > 0.01) {
    return NextResponse.json(
      { error: `Payment percentages must sum to 100% (got ${sum}%)` },
      { status: 400 },
    );
  }

  await ensureBrand();
  const updated = await prisma.roofingBrand.update({
    where: { id: "default" },
    data: {
      companyName: data.companyName,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      website: data.website ?? null,
      roofingLicense: data.roofingLicense ?? null,
      gcLicense: data.gcLicense ?? null,
      defaultExpirationDays: data.defaultExpirationDays,
      defaultUnderlaymentType: data.defaultUnderlaymentType ?? null,
      defaultPlywoodSheetsIncluded: data.defaultPlywoodSheetsIncluded,
      defaultAdditionalPlywoodPrice: data.defaultAdditionalPlywoodPrice,
      defaultWorkmanshipWarrantyYears: data.defaultWorkmanshipWarrantyYears,
      defaultManufacturerWarranty: data.defaultManufacturerWarranty ?? null,
      paymentDepositPercent: data.paymentDepositPercent,
      paymentProgressPercent: data.paymentProgressPercent,
      paymentFinalPercent: data.paymentFinalPercent,
    },
  });
  return NextResponse.json(updated);
}
