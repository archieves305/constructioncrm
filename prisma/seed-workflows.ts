import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedTemplateGenerations } from "../src/lib/workflows/seed";
import { WORKFLOW_SEED_GENERATIONS } from "./seeds/workflows";

/**
 * Seed the workflow templates, generation by generation. Idempotent; safe
 * on prod. `--dry-run` reports what it would do and writes nothing:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-workflows.ts --dry-run"'
 *
 * Also called from prisma/seed.ts (dev) and scripts/seed-prod.ts.
 */
export async function seedWorkflowTemplates(prisma: PrismaClient, log: (line: string) => void = console.log, opts: { dryRun?: boolean } = {}) {
  log(opts.dryRun ? "Workflow templates (dry run, nothing is written)..." : "Seeding workflow templates...");
  for (const t of WORKFLOW_SEED_GENERATIONS) {
    await seedTemplateGenerations(prisma, t.key, t.generations, { log, dryRun: opts.dryRun });
  }
}

const isMain = process.argv[1]?.endsWith("seed-workflows.ts");
if (isMain) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedWorkflowTemplates(prisma, console.log, { dryRun: process.argv.includes("--dry-run") })
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
