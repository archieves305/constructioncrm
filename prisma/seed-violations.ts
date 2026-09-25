import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { VIOLATION_CATEGORIES } from "./seeds/violations/categories";

/**
 * Seed the code-violation categories. Idempotent (upsert by key); safe on
 * prod — a renamed category keeps its id, and items keep pointing at it:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-violations.ts"'
 *
 * Also called from prisma/seed.ts (dev) and scripts/seed-prod.ts. The
 * violation WORKFLOW template is seeded by prisma/seed-workflows.ts with the
 * others.
 */
export async function seedViolationCategories(prisma: PrismaClient, log: (line: string) => void = console.log) {
  log("Seeding code-violation categories...");
  let created = 0;
  for (const [i, c] of VIOLATION_CATEGORIES.entries()) {
    const existing = await prisma.codeViolationCategory.findUnique({ where: { key: c.key }, select: { id: true } });
    await prisma.codeViolationCategory.upsert({
      where: { key: c.key },
      create: {
        key: c.key,
        name: c.name,
        defaultResponsibleTrade: c.defaultResponsibleTrade ?? null,
        defaultPermitRequirement: c.defaultPermitRequirement ?? "UNDETERMINED",
        defaultConstructionRequired: c.defaultConstructionRequired ?? false,
        sortOrder: (i + 1) * 10,
        isActive: true,
      },
      // Never overwrite an admin's rename or ordering; only fill the seed defaults on first insert.
      update: {},
    });
    if (!existing) created++;
  }
  log(`  ${VIOLATION_CATEGORIES.length} categories (${created} created, ${VIOLATION_CATEGORIES.length - created} unchanged)`);
}

const isMain = process.argv[1]?.endsWith("seed-violations.ts");
if (isMain) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedViolationCategories(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
