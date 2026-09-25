import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { NURTURE_SEEDS } from "./seeds/nurture/content";

/**
 * Seed the nurture settings row and the default email library. Idempotent;
 * safe on prod:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-nurture.ts"'
 *
 * Settings are create-only (never reset an operator's cadence). Content is
 * keyed by seedKey: created when missing, refreshed only while `editedAt`
 * is null — a row edited in the admin is kept as edited.
 */
export async function seedNurture(prisma: PrismaClient, log: (line: string) => void = console.log) {
  log("Seeding nurture settings + content...");
  const onHold = await prisma.leadStage.findFirst({ where: { name: "On Hold" }, select: { id: true } });
  await prisma.nurtureSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", excludedStageIds: onHold ? [onHold.id] : [] },
  });
  for (const def of NURTURE_SEEDS) {
    const existing = await prisma.nurtureContent.findUnique({ where: { seedKey: def.seedKey }, select: { id: true, editedAt: true, subject: true, body: true, sortOrder: true } });
    if (!existing) {
      await prisma.nurtureContent.create({
        data: { seedKey: def.seedKey, kind: def.kind, step: def.step ?? null, subject: def.subject, body: def.body, category: def.category ?? null, sortOrder: def.sortOrder },
      });
      log(`  ${def.seedKey}: created`);
    } else if (existing.editedAt) {
      log(`  ${def.seedKey}: kept (edited in admin)`);
    } else if (existing.subject !== def.subject || existing.body !== def.body || existing.sortOrder !== def.sortOrder) {
      await prisma.nurtureContent.update({ where: { id: existing.id }, data: { subject: def.subject, body: def.body, sortOrder: def.sortOrder, category: def.category ?? null, step: def.step ?? null } });
      log(`  ${def.seedKey}: refreshed`);
    } else {
      log(`  ${def.seedKey}: unchanged`);
    }
  }
}

const isMain = process.argv[1]?.endsWith("seed-nurture.ts");
if (isMain) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedNurture(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
