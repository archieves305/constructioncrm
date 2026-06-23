// Prod-safe standalone seeder for estimate templates ONLY.
//
// Unlike prisma/seed.ts (which also creates demo roles/users/leads/prospects and
// is NOT safe to run in production), this script touches only the estimate
// template tables and is idempotent. Run after a deploy:
//
//   ssh knuco-droplet "cd /opt/knuco && set -a; . /etc/knuco/env; set +a; \
//     npx tsx prisma/seed-estimate-templates-cli.ts"
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedEstimateTemplates } from "./seed-estimate-templates";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

seedEstimateTemplates(prisma)
  .then(async () => {
    const templates = await prisma.estimateTemplate.count();
    const sections = await prisma.estimateTemplateSection.count();
    const items = await prisma.estimateTemplateLineItem.count();
    console.log(
      `Estimate templates ready: ${templates} templates, ${sections} sections, ${items} line items.`,
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
