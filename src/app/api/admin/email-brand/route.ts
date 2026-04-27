import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { invalidateEmailBrandCache } from "@/lib/email/brand";

export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const brand = await prisma.emailBrand.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", companyName: "Knu Construction" },
  });
  return NextResponse.json(brand);
}

const schema = z.object({
  companyName: z.string().trim().min(1),
  addressLine1: z.string().trim().nullable().optional(),
  addressLine2: z.string().trim().nullable().optional(),
  city: z.string().trim().nullable().optional(),
  state: z.string().trim().nullable().optional(),
  zip: z.string().trim().nullable().optional(),
  officePhone: z.string().trim().nullable().optional(),
  mobilePhone: z.string().trim().nullable().optional(),
  contactEmail: z
    .string()
    .trim()
    .email()
    .nullable()
    .optional()
    .or(z.literal("")),
  website: z.string().trim().nullable().optional(),
  logoUrl: z.string().trim().nullable().optional().or(z.literal("")),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #1f2937"),
  signatureHtml: z.string().nullable().optional(),
  signatureText: z.string().nullable().optional(),
});

function blank(s: string | null | undefined): string | null {
  if (s === undefined) return null;
  if (s === null) return null;
  return s.trim() === "" ? null : s.trim();
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const v = await validateBody(req, schema);
  if (!v.ok) return v.response;
  const data = v.data;

  const updated = await prisma.emailBrand.upsert({
    where: { id: "default" },
    update: {
      companyName: data.companyName,
      addressLine1: blank(data.addressLine1),
      addressLine2: blank(data.addressLine2),
      city: blank(data.city),
      state: blank(data.state),
      zip: blank(data.zip),
      officePhone: blank(data.officePhone),
      mobilePhone: blank(data.mobilePhone),
      contactEmail: blank(data.contactEmail),
      website: blank(data.website),
      logoUrl: blank(data.logoUrl),
      primaryColor: data.primaryColor,
      signatureHtml: blank(data.signatureHtml),
      signatureText: blank(data.signatureText),
    },
    create: {
      id: "default",
      companyName: data.companyName,
      primaryColor: data.primaryColor,
    },
  });

  invalidateEmailBrandCache();
  return NextResponse.json(updated);
}
