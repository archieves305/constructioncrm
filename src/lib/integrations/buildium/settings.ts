import { prisma } from "@/lib/db/prisma";

export const BUILDIUM_SETTING_KEYS = {
  KNU_VENDOR_ID: "KNU_VENDOR_ID",
  KNU_VENDOR_CATEGORY_ID: "KNU_VENDOR_CATEGORY_ID",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.buildiumSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.buildiumSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
