import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { readFile } from "@/lib/files/storage";

// Brand/letterhead data for estimate PDFs.
//
// The brand table (RoofingBrand) holds one row per company:
//   - "default" → NewCoast Roofing (used by the roofing estimator, unchanged)
//   - "knu"     → Knu Construction (used by the generic/non-roofing estimator)
//
// Per business rule, non-roofing estimates differ from roofing ONLY by company
// name + logo; all other letterhead (address, phone, email, website, licenses,
// payment terms) is shared. So the non-roofing brand inherits the NewCoast row
// and overrides just the name + logo — they can never drift out of sync.
export const NEWCOAST_BRAND_ID = "default";
export const KNU_BRAND_ID = "knu";

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

export async function ensureBrandRow(id: string, defaultName: string) {
  let brand = await prisma.roofingBrand.findUnique({ where: { id } });
  if (!brand) {
    brand = await prisma.roofingBrand.create({
      data: { id, companyName: defaultName },
    });
  }
  return brand;
}

// Encode a stored logo as a data URI so @react-pdf can render it without a live
// HTTP fetch at PDF-generation time.
async function encodeLogo(storageKey: string | null): Promise<string | null> {
  if (!storageKey) return null;
  try {
    const buf = await readFile(storageKey);
    const ext = path.extname(storageKey).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

type BrandRow = Awaited<ReturnType<typeof ensureBrandRow>>;

function mapBrand(row: BrandRow, logoDataUri: string | null): EstimateBrand {
  return {
    companyName: row.companyName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    phone: row.phone,
    email: row.email,
    website: row.website,
    roofingLicense: row.roofingLicense,
    gcLicense: row.gcLicense,
    logoDataUri,
    paymentDepositPercent: Number(row.paymentDepositPercent),
    paymentProgressPercent: Number(row.paymentProgressPercent),
    paymentFinalPercent: Number(row.paymentFinalPercent),
  };
}

// Brand for non-roofing (generic) estimates: NewCoast letterhead + Knu name/logo.
export async function loadEstimateBrand(): Promise<EstimateBrand> {
  const base = await ensureBrandRow(NEWCOAST_BRAND_ID, "NewCoast Roofing");
  const knu = await ensureBrandRow(KNU_BRAND_ID, "Knu Construction");
  const logoDataUri = await encodeLogo(knu.logoStorageKey);
  return { ...mapBrand(base, logoDataUri), companyName: knu.companyName };
}

export function safeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Client";
}
