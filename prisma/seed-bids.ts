import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_HOLIDAYS } from "../src/lib/bids/holidays";

/**
 * Seed what the PlanHub bid projects need. Idempotent and create-only, so an
 * operator's edits are never reset:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-bids.ts"'
 *
 * - Company days off (US federal holidays 2026–2027) by day; Admin edits them.
 * - The follow-up settings row (code defaults until someone changes them).
 */
async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    let created = 0;
    for (const h of DEFAULT_HOLIDAYS) {
      const hit = await prisma.businessHoliday.findUnique({ where: { day: h.day } });
      if (hit) continue;
      await prisma.businessHoliday.create({ data: h });
      created += 1;
    }
    console.log(`holidays: created ${created}, unchanged ${DEFAULT_HOLIDAYS.length - created}`);
    const s = await prisma.bidFollowUpSettings.findUnique({ where: { id: "singleton" } });
    if (!s) await prisma.bidFollowUpSettings.create({ data: { id: "singleton" } });
    console.log(`follow-up settings: ${s ? "unchanged" : "created"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
