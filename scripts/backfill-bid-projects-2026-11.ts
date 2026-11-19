import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { bidProjectNumber, projectAddressKey } from "../src/lib/bids/states";

/**
 * Give every bid that predates PlanHub bid projects a project of its own.
 *
 *   npx tsx scripts/backfill-bid-projects-2026-11.ts           # dry run: prints the plan, writes nothing
 *   npx tsx scripts/backfill-bid-projects-2026-11.ts --apply   # writes
 *
 * Per invitation with no project: a project from its name, site and platform;
 * one scope per trade on its lead; the GC's scope rows mirroring the bid's
 * outcome (AWARDED → EXECUTED under one award linked to the existing job,
 * LOST / NO_BID / CANCELLED likewise, open → PENDING). No follow-up is
 * raised: the cadence starts only from a submission recorded from now on.
 * Idempotent: a bid that has a project is skipped.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const bids = await prisma.bidInvitation.findMany({
      where: { bidProjectId: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, number: true, projectName: true, projectType: true, platform: true, platformRef: true, platformUrl: true, status: true, outcome: true, lossReason: true, outcomeAt: true, awardedAmount: true, createdByUserId: true, organizationId: true,
        organization: { select: { name: true, ownerUserId: true } },
        lead: { select: { assignedUserId: true, propertyAddress1: true, propertyAddress2: true, city: true, state: true, zipCode: true, county: true, services: { select: { serviceCategoryId: true, serviceCategory: { select: { name: true } } } }, jobs: { orderBy: { createdAt: "asc" }, select: { id: true, jobNumber: true, contractAmount: true, sourceBidAwardId: true } } } },
      },
    });
    console.log(`${bids.length} bid(s) without a project${apply ? "" : " (dry run — nothing written)"}`);
    for (const b of bids) {
      const scopeStatus = b.outcome === "AWARDED" ? "EXECUTED" : b.outcome === "LOST" ? "LOST" : b.outcome === "NO_BID" ? "NO_BID" : b.outcome === "CANCELLED" || b.outcome === "NO_DECISION" || b.outcome === "REBID" ? "CANCELLED" : "PENDING";
      const job = b.lead.jobs.find((j) => !j.sourceBidAwardId) ?? null;
      console.log(`  ${b.number} · ${b.organization.name} · ${b.projectName} · ${b.status}${b.outcome ? `/${b.outcome}` : ""} → scopes ${b.lead.services.map((s) => s.serviceCategory.name).join(", ") || "(none)"} as ${scopeStatus}${b.outcome === "AWARDED" ? ` · award ${Number(b.awardedAmount ?? job?.contractAmount ?? 0)} → ${job?.jobNumber ?? "no job"}` : ""}`);
      if (!apply) continue;
      if (b.lead.services.length === 0) {
        console.log("    skipped: the bid's lead has no trade");
        continue;
      }
      await prisma.$transaction(async (tx) => {
        const n = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('bid_project_number_seq') AS n`;
        const project = await tx.bidProject.create({
          data: {
            number: bidProjectNumber(Number(n[0]!.n)),
            name: b.projectName,
            address1: b.lead.propertyAddress1, address2: b.lead.propertyAddress2, city: b.lead.city, state: b.lead.state, zipCode: b.lead.zipCode, county: b.lead.county,
            addressKey: projectAddressKey(b.lead.propertyAddress1, b.lead.zipCode),
            source: b.platform, platformRef: b.platform === "PLANHUB" ? b.platformRef : null, platformUrl: b.platformUrl, projectType: b.projectType,
            stage: b.status === "CLOSED" ? "CLOSED" : "OPEN",
            ownerUserId: b.lead.assignedUserId ?? b.organization.ownerUserId,
            createdByUserId: b.createdByUserId,
          },
        });
        const scopeIds: string[] = [];
        for (const [i, s] of b.lead.services.entries()) {
          const scope = await tx.bidProjectScope.create({ data: { bidProjectId: project.id, serviceCategoryId: s.serviceCategoryId, label: s.serviceCategory.name, sortOrder: i } });
          scopeIds.push(scope.id);
        }
        await tx.bidInvitation.update({ where: { id: b.id }, data: { bidProjectId: project.id, primeStatus: b.outcome === "AWARDED" ? "GC_AWARDED" : "UNKNOWN" } });
        let awardId: string | null = null;
        if (b.outcome === "AWARDED") {
          const award = await tx.bidAward.create({ data: { bidInvitationId: b.id, kind: "EXECUTED", amount: Number(b.awardedAmount ?? job?.contractAmount ?? 0), awardedAt: b.outcomeAt ?? new Date(), notes: "Recorded before bid projects existed (backfill 2026-11)", createdByUserId: b.createdByUserId } });
          awardId = award.id;
          if (job) await tx.job.update({ where: { id: job.id }, data: { sourceBidAwardId: award.id } });
        }
        await tx.bidOpportunityScope.createMany({ data: scopeIds.map((scopeId) => ({ bidInvitationId: b.id, scopeId, status: scopeStatus, awardId, lossReason: scopeStatus === "LOST" ? b.lossReason : null, decidedAt: scopeStatus === "PENDING" ? null : (b.outcomeAt ?? new Date()) })) });
        await tx.auditEvent.create({ data: { actorUserId: null, entityType: "BidProject", entityId: project.id, action: "bid_project_backfill", afterJson: { number: project.number, bidId: b.id, bidNumber: b.number, scopes: scopeIds.length, scopeStatus, awardId, jobId: job?.id ?? null } } });
        console.log(`    created ${project.number}`);
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
