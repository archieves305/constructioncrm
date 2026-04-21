import { env } from "@/lib/env";
import { buildiumRequest } from "./client";
import {
  BUILDIUM_SETTING_KEYS,
  getSetting,
  setSetting,
} from "./settings";

type BuildiumVendor = {
  Id: number;
  CompanyName?: string;
  IsCompany?: boolean;
  Category?: { Id: number; Name: string } | null;
};

type BuildiumVendorCategory = {
  Id: number;
  Name: string;
};

async function findVendorByName(name: string): Promise<BuildiumVendor | null> {
  const target = name.trim().toLowerCase();
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await buildiumRequest<BuildiumVendor[]>("/vendors", {
      query: { limit: pageSize, offset },
    });
    if (!Array.isArray(page) || page.length === 0) return null;
    const hit = page.find(
      (v) => (v.CompanyName ?? "").trim().toLowerCase() === target,
    );
    if (hit) return hit;
    if (page.length < pageSize) return null;
  }
  return null;
}

async function ensureVendorCategoryId(): Promise<number> {
  const cached = await getSetting(BUILDIUM_SETTING_KEYS.KNU_VENDOR_CATEGORY_ID);
  if (cached) return Number(cached);

  const categories = await buildiumRequest<BuildiumVendorCategory[]>(
    "/vendors/categories",
    { query: { limit: 100 } },
  );
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error(
      "Buildium has no vendor categories. Create one in Buildium → Vendors → Categories.",
    );
  }
  const preferred =
    categories.find((c) => /contractors?\s*[-–]\s*general/i.test(c.Name)) ??
    categories.find((c) => /general\s+contractor/i.test(c.Name)) ??
    categories.find((c) => /construction/i.test(c.Name)) ??
    categories.find((c) => /contractor|repair|maintenance/i.test(c.Name)) ??
    categories[0];
  await setSetting(
    BUILDIUM_SETTING_KEYS.KNU_VENDOR_CATEGORY_ID,
    String(preferred.Id),
  );
  return preferred.Id;
}

export async function ensureKnuVendorId(): Promise<number> {
  const cached = await getSetting(BUILDIUM_SETTING_KEYS.KNU_VENDOR_ID);
  if (cached) return Number(cached);

  const name = env.BUILDIUM_VENDOR_NAME;
  const existing = await findVendorByName(name);
  if (existing) {
    await setSetting(BUILDIUM_SETTING_KEYS.KNU_VENDOR_ID, String(existing.Id));
    return existing.Id;
  }

  const categoryId = await ensureVendorCategoryId();
  const created = await buildiumRequest<BuildiumVendor>("/vendors", {
    method: "POST",
    body: {
      CompanyName: name,
      IsCompany: true,
      CategoryId: categoryId,
    },
  });
  if (!created?.Id) {
    throw new Error("Buildium vendor create did not return an Id.");
  }
  await setSetting(BUILDIUM_SETTING_KEYS.KNU_VENDOR_ID, String(created.Id));
  return created.Id;
}
