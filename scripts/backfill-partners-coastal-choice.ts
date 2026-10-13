import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off: attach KNU's one existing GC job to a Business Development account.
 *
 * JOB-00009 (Towne Place Suites, Clewiston — the $832,500 drywall package) was
 * imported as a Lead carrying the general contractor's name, before accounts
 * existed. This creates "Coastal Choice Construction" as an ACTIVE account,
 * marks that lead a GC bid package and links it. Dry run by default:
 *
 *   npx tsx scripts/backfill-partners-coastal-choice.ts            # report only
 *   npx tsx scripts/backfill-partners-coastal-choice.ts --apply    # write
 *   npx tsx scripts/backfill-partners-coastal-choice.ts --apply --fix-billing
 *
 * `--fix-billing` additionally sets the job to PROGRESS billing with 10 %
 * retainage (the import never set either); it prints the current values
 * either way and only writes them on that flag. Idempotent: a lead already
 * linked to an account is left alone.
 */
const ORG_NAME = "Coastal Choice Construction";
const NAME_KEY = "coastal choice construction";
const JOB_NUMBER = "JOB-00009";

const apply = process.argv.includes("--apply");
const fixBilling = process.argv.includes("--fix-billing");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const job =
      (await prisma.job.findUnique({ where: { jobNumber: JOB_NUMBER }, select: { id: true, jobNumber: true, title: true, billingMethod: true, retainagePercent: true, contractAmount: true, salesRepId: true, projectManagerId: true, leadId: true } })) ??
      (await prisma.job.findFirst({ where: { title: { contains: "Towne Place Suites", mode: "insensitive" } }, select: { id: true, jobNumber: true, title: true, billingMethod: true, retainagePercent: true, contractAmount: true, salesRepId: true, projectManagerId: true, leadId: true } }));
    if (!job) {
      console.log("No JOB-00009 / Towne Place Suites job found. Nothing to do.");
      return;
    }
    const lead = await prisma.lead.findUnique({ where: { id: job.leadId }, select: { id: true, kind: true, fullName: true, companyName: true, organizationId: true, mailingAddress1: true, mailingAddress2: true, city: true, state: true, zipCode: true, primaryPhone: true } });
    if (!lead) throw new Error("The job's lead is missing");

    console.log(`Job ${job.jobNumber}: ${job.title}`);
    console.log(`  billingMethod=${job.billingMethod} retainagePercent=${job.retainagePercent} contractAmount=${job.contractAmount}`);
    console.log(`Lead ${lead.id}: ${lead.fullName} / ${lead.companyName ?? "—"} kind=${lead.kind} organizationId=${lead.organizationId ?? "—"}`);

    if (lead.organizationId) {
      console.log("Already linked to an account — nothing to do.");
      return;
    }

    const existing = await prisma.organization.findUnique({ where: { nameKey: NAME_KEY }, select: { id: true, name: true } });
    const drywall = await prisma.serviceCategory.findFirst({ where: { name: { equals: "Drywall", mode: "insensitive" }, parentId: null }, select: { id: true } });
    const ownerId = job.salesRepId ?? job.projectManagerId ?? (await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
    if (!ownerId) throw new Error("No owner could be chosen (no active admin)");

    // The lead's mailing address is the GC's office (Lighthouse Point) on the Clewiston import.
    const hq = lead.mailingAddress1 ? { address1: lead.mailingAddress1, address2: lead.mailingAddress2 ?? null } : {};
    console.log(`Account "${ORG_NAME}": ${existing ? `exists (${existing.id})` : "would be created"} — stage ACTIVE, owner ${ownerId}, trade ${drywall ? "Drywall" : "(none found)"}`);
    console.log(`Lead would become kind=GC_BID and point at the account.`);
    if (fixBilling) console.log(`Job would be set to billingMethod=PROGRESS retainagePercent=10.`);

    if (!apply) {
      console.log("\nDry run — nothing written. Re-run with --apply to write.");
      return;
    }

    const org =
      existing ??
      (await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: {
            name: ORG_NAME,
            nameKey: NAME_KEY,
            kind: "GENERAL_CONTRACTOR",
            ...hq,
            city: lead.mailingAddress1 ? null : lead.city,
            state: "FL",
            stage: "ACTIVE",
            ownerUserId: ownerId,
            createdByUserId: ownerId,
            notes: `Backfilled from ${job.jobNumber} (${job.title}).`,
            trades: drywall ? { create: [{ serviceCategoryId: drywall.id }] } : undefined,
          },
          select: { id: true, name: true },
        });
        await tx.partnerStageHistory.create({ data: { organizationId: created.id, fromStage: null, toStage: "ACTIVE", reason: "backfill", changedByUserId: ownerId } });
        await tx.auditEvent.create({ data: { actorUserId: ownerId, entityType: "Organization", entityId: created.id, action: "create", afterJson: { name: ORG_NAME, stage: "ACTIVE", source: "backfill-partners-coastal-choice" } } });
        return created;
      }));

    await prisma.lead.update({ where: { id: lead.id }, data: { kind: "GC_BID", organizationId: org.id } });
    await prisma.auditEvent.create({ data: { actorUserId: ownerId, entityType: "Lead", entityId: lead.id, action: "update", beforeJson: { kind: lead.kind, organizationId: null }, afterJson: { kind: "GC_BID", organizationId: org.id, source: "backfill-partners-coastal-choice" } } });
    console.log(`Linked lead ${lead.id} → account ${org.id} (${org.name}).`);

    if (fixBilling) {
      await prisma.job.update({ where: { id: job.id }, data: { billingMethod: "PROGRESS", retainagePercent: 10 } });
      await prisma.auditEvent.create({ data: { actorUserId: ownerId, entityType: "Job", entityId: job.id, action: "pricing_update", beforeJson: { billingMethod: job.billingMethod, retainagePercent: job.retainagePercent }, afterJson: { billingMethod: "PROGRESS", retainagePercent: 10, source: "backfill-partners-coastal-choice" } } });
      console.log("Job billing set to PROGRESS / 10%.");
    }
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
