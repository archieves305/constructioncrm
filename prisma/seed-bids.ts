import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_HOLIDAYS } from "../src/lib/bids/holidays";
import { DEFAULT_TEMPLATES } from "../src/lib/bids/templates";

/**
 * Seed what the PlanHub bid projects need. Idempotent and create-only, so an
 * operator's edits are never reset:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-bids.ts"'
 *
 * - Company days off (US federal holidays 2026–2027) by day; Admin edits them.
 * - The follow-up settings row (code defaults until someone changes them).
 * - The follow-up email templates, by key (an edited template is left alone).
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
    let made = 0;
    for (const t of DEFAULT_TEMPLATES) {
      const hit = await prisma.bidEmailTemplate.findUnique({ where: { key: t.key } });
      if (hit) continue;
      await prisma.bidEmailTemplate.create({ data: { key: t.key, name: t.name, subject: t.subject, body: t.body, autoSendable: t.autoSendable } });
      made += 1;
    }
    console.log(`email templates: created ${made}, unchanged ${DEFAULT_TEMPLATES.length - made}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
