import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { upsertContractTemplateVersion } from "../src/lib/customer-contracts/templates";
import {
  CONTRACT_TEMPLATE_VERSION,
  RESIDENTIAL_CONSTRUCTION_META,
  RESIDENTIAL_CONSTRUCTION_V1,
} from "./seeds/contract-templates/residential-construction";

/**
 * Seed the default customer-contract template. Idempotent; safe on prod:
 *
 *   ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-contract-templates.ts"'
 *
 * Also called from prisma/seed.ts (dev). A version pinned by a contract is
 * never rewritten — bump CONTRACT_TEMPLATE_VERSION in the spec instead.
 */
export async function seedContractTemplates(prisma: PrismaClient, log: (line: string) => void = console.log) {
  log("Seeding contract templates...");
  await upsertContractTemplateVersion(
    prisma,
    { ...RESIDENTIAL_CONSTRUCTION_META, content: RESIDENTIAL_CONSTRUCTION_V1, isDefault: true },
    { version: CONTRACT_TEMPLATE_VERSION, log },
  );
}

const isMain = process.argv[1]?.endsWith("seed-contract-templates.ts");
if (isMain) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  seedContractTemplates(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
