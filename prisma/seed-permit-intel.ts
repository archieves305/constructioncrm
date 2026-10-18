import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PERMIT_TYPE_SEED } from "../src/lib/permit-intel/catalog";

/**
 * Seed what Permit Intelligence needs. Idempotent; safe on prod:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-permit-intel.ts"'
 *
 * - The permit-type catalog, created only when a key is missing (a renamed
 *   type is never overwritten).
 * - One company-wide requirement — the completed application — created only
 *   when no requirement asks for it yet. Everything else on the checklist is
 *   entered under Admin → Permits, per jurisdiction.
 */
export async function seedPermitIntel(prisma: PrismaClient, log: (line: string) => void = console.log) {
  for (const [i, t] of PERMIT_TYPE_SEED.entries()) {
    const found = await prisma.permitTypeDef.findUnique({ where: { key: t.key }, select: { id: true } });
    if (found) {
      log(`  permit type ${t.key}: unchanged`);
      continue;
    }
    await prisma.permitTypeDef.create({ data: { key: t.key, name: t.name, sortOrder: (i + 1) * 10 } });
    log(`  permit type ${t.key}: created`);
  }
  const app = await prisma.permitKnowledge.findFirst({ where: { kind: "REQUIREMENT", documentType: "completed_application" }, select: { id: true } });
  if (app) log("  requirement completed_application: unchanged");
  else {
    await prisma.permitKnowledge.create({
      data: { kind: "REQUIREMENT", status: "APPROVED", reliability: "INTERNAL", title: "Completed application form", documentType: "completed_application", required: true, sortOrder: 10, decidedAt: new Date() },
    });
    log("  requirement completed_application: created");
  }
}

if (process.argv[1]?.endsWith("seed-permit-intel.ts")) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedPermitIntel(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
