import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Seed what the Business Development module needs. Idempotent; safe on prod:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-partners.ts"'
 *
 * - The three service categories KNU bids that the lead seed never had
 *   (Plumbing, Demolition, General Construction), created only when missing.
 * - The "GC bid invitation" lead source (Stage 3 creates bid leads under it).
 * - The settings row, create-only: an operator's thresholds are never reset.
 */
export const PARTNER_SERVICE_CATEGORIES = ["Plumbing", "Demolition", "General Construction"] as const;
export const GC_BID_SOURCE_NAME = "GC bid invitation";
export const DEFAULT_PARTNER_MARKETS = ["Miami-Dade", "Broward", "Palm Beach", "St. Lucie", "Orange", "Brevard", "Hillsborough", "Pinellas", "Martin", "Hendry", "Lee", "Collier"];

export async function seedPartners(prisma: PrismaClient, log: (line: string) => void = console.log) {
  log("Seeding Business Development...");

  const top = await prisma.serviceCategory.findMany({ where: { parentId: null }, select: { id: true, name: true, sortOrder: true } });
  let nextOrder = Math.max(0, ...top.map((c) => c.sortOrder)) + 1;
  for (const name of PARTNER_SERVICE_CATEGORIES) {
    const existing = top.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      log(`  service category ${name}: unchanged`);
      continue;
    }
    await prisma.serviceCategory.create({ data: { name, sortOrder: nextOrder++ } });
    log(`  service category ${name}: created`);
  }

  const source = await prisma.leadSource.findFirst({ where: { name: GC_BID_SOURCE_NAME }, select: { id: true } });
  if (source) log(`  lead source "${GC_BID_SOURCE_NAME}": unchanged`);
  else {
    await prisma.leadSource.create({ data: { name: GC_BID_SOURCE_NAME, channelType: "DIRECT" } });
    log(`  lead source "${GC_BID_SOURCE_NAME}": created`);
  }

  const settings = await prisma.partnerSettings.findUnique({ where: { id: "default" }, select: { id: true } });
  if (settings) log("  settings: unchanged");
  else {
    await prisma.partnerSettings.create({ data: { id: "default", markets: DEFAULT_PARTNER_MARKETS } });
    log("  settings: created");
  }
}

if (process.argv[1]?.endsWith("seed-partners.ts")) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedPartners(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
