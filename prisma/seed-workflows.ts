import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { upsertTemplateVersion } from "../src/lib/workflows/seed";
import { WORKFLOW_TEMPLATE_SPECS, WORKFLOW_TEMPLATE_VERSION } from "./seeds/workflows";

/**
 * Seed the four v1 workflow templates. Idempotent; safe on prod:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-workflows.ts"'
 *
 * Also called from prisma/seed.ts (dev) and scripts/seed-prod.ts.
 */
export async function seedWorkflowTemplates(prisma: PrismaClient, log: (line: string) => void = console.log) {
  log("Seeding workflow templates...");
  for (const def of WORKFLOW_TEMPLATE_SPECS) {
    await upsertTemplateVersion(prisma, def, { version: WORKFLOW_TEMPLATE_VERSION, log });
  }
}

const isMain = process.argv[1]?.endsWith("seed-workflows.ts");
if (isMain) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedWorkflowTemplates(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
