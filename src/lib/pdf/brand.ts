import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { readFile } from "@/lib/files/storage";

// Shared brand/letterhead data for estimate PDFs. The roofing PDF route keeps
// its own private copy of this loader (to stay untouched); the generic estimate
// engine uses this shared one.
export type EstimateBrand = {
  companyName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  roofingLicense: string | null;
  gcLicense: string | null;
  logoDataUri: string | null;
  paymentDepositPercent: number;
  paymentProgressPercent: number;
  paymentFinalPercent: number;
};

export async function loadEstimateBrand(): Promise<EstimateBrand> {
  let brand = await prisma.roofingBrand.findUnique({ where: { id: "default" } });
  if (!brand) {
    brand = await prisma.roofingBrand.create({
      data: { id: "default", companyName: "NewCoast Roofing" },
    });
  }

  // Encode the logo as a data URI so @react-pdf can render it without
  // depending on a live HTTP fetch at PDF-generation time.
  let logoDataUri: string | null = null;
  if (brand.logoStorageKey) {
    try {
      const buf = await readFile(brand.logoStorageKey);
      const ext = path.extname(brand.logoStorageKey).toLowerCase();
      const mime =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/png";
      logoDataUri = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      logoDataUri = null;
    }
  }

  return {
    companyName: brand.companyName,
    addressLine1: brand.addressLine1,
    addressLine2: brand.addressLine2,
    city: brand.city,
    state: brand.state,
    zip: brand.zip,
    phone: brand.phone,
    email: brand.email,
    website: brand.website,
    roofingLicense: brand.roofingLicense,
    gcLicense: brand.gcLicense,
    logoDataUri,
    paymentDepositPercent: Number(brand.paymentDepositPercent),
    paymentProgressPercent: Number(brand.paymentProgressPercent),
    paymentFinalPercent: Number(brand.paymentFinalPercent),
  };
}

export function safeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Client";
}
