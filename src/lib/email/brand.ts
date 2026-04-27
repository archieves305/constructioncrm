import { prisma } from "@/lib/db/prisma";

export type EmailBrand = {
  id: string;
  companyName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  contactEmail: string | null;
  website: string | null;
  logoUrl: string | null;
  primaryColor: string;
  signatureHtml: string | null;
  signatureText: string | null;
};

let cache: { brand: EmailBrand; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getEmailBrand(): Promise<EmailBrand> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.brand;
  }
  const row = await prisma.emailBrand.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", companyName: "Knu Construction" },
  });
  cache = { brand: row, fetchedAt: Date.now() };
  return row;
}

export function invalidateEmailBrandCache(): void {
  cache = null;
}

export function formatBrandAddress(brand: EmailBrand): string {
  const cityStateZip = [brand.city, brand.state].filter(Boolean).join(", ");
  const cityLine = [cityStateZip, brand.zip].filter(Boolean).join(" ");
  return [brand.addressLine1, brand.addressLine2, cityLine].filter(Boolean).join(", ");
}
