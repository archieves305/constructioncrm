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
export const DEFAULT_REQUIREMENT_KEYS = ["w9", "gl_coi", "wc_coi", "auto_coi", "contractor_license", "safety_program", "emr_letter", "references"];

/** The kinds of document a GC may ask for. Upserted by key; a renamed row is never overwritten. */
export const COMPANY_DOCUMENT_TYPES: { key: string; name: string; category: "insurance" | "licensing" | "safety" | "financial" | "company"; defaultValidityMonths: number | null }[] = [
  { key: "w9", name: "W-9", category: "financial", defaultValidityMonths: null },
  { key: "gl_coi", name: "General liability COI", category: "insurance", defaultValidityMonths: 12 },
  { key: "wc_coi", name: "Workers' compensation COI (or exemption)", category: "insurance", defaultValidityMonths: 12 },
  { key: "auto_coi", name: "Auto liability COI", category: "insurance", defaultValidityMonths: 12 },
  { key: "umbrella_coi", name: "Umbrella / excess COI", category: "insurance", defaultValidityMonths: 12 },
  { key: "contractor_license", name: "Contractor licence", category: "licensing", defaultValidityMonths: 24 },
  { key: "trade_license", name: "Trade licences", category: "licensing", defaultValidityMonths: 24 },
  { key: "safety_program", name: "Safety program / manual", category: "safety", defaultValidityMonths: null },
  { key: "osha_300", name: "OSHA 300 / 300A logs", category: "safety", defaultValidityMonths: 12 },
  { key: "emr_letter", name: "EMR letter", category: "safety", defaultValidityMonths: 12 },
  { key: "financial_statements", name: "Financial statements", category: "financial", defaultValidityMonths: 12 },
  { key: "banking_letter", name: "Banking reference letter", category: "financial", defaultValidityMonths: 12 },
  { key: "bonding_letter", name: "Bonding capacity letter", category: "financial", defaultValidityMonths: 12 },
  { key: "references", name: "Project references", category: "company", defaultValidityMonths: null },
  { key: "project_history", name: "Project history", category: "company", defaultValidityMonths: null },
  { key: "capabilities_statement", name: "Capabilities statement", category: "company", defaultValidityMonths: null },
];

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

  const settings = await prisma.partnerSettings.findUnique({ where: { id: "default" }, select: { id: true, defaultRequirementTypeKeys: true } });
  if (!settings) {
    await prisma.partnerSettings.create({ data: { id: "default", markets: DEFAULT_PARTNER_MARKETS, defaultRequirementTypeKeys: DEFAULT_REQUIREMENT_KEYS } });
    log("  settings: created");
  } else if (settings.defaultRequirementTypeKeys.length === 0) {
    // Stage 1 created the row before the checklist default existed; fill it once, never overwrite an edit.
    await prisma.partnerSettings.update({ where: { id: "default" }, data: { defaultRequirementTypeKeys: DEFAULT_REQUIREMENT_KEYS } });
    log("  settings: default requirement set filled");
  } else log("  settings: unchanged");

  for (const [i, t] of COMPANY_DOCUMENT_TYPES.entries()) {
    const existing = await prisma.companyDocumentType.findUnique({ where: { key: t.key }, select: { id: true } });
    if (existing) {
      log(`  document type ${t.key}: unchanged`);
      continue;
    }
    await prisma.companyDocumentType.create({ data: { key: t.key, name: t.name, category: t.category, defaultValidityMonths: t.defaultValidityMonths, sortOrder: i + 1 } });
    log(`  document type ${t.key}: created`);
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
