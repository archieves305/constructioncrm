import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * One-off: give KNU's one existing GC job the bid record it would have had.
 *
 * JOB-00009 (Towne Place Suites, Clewiston) is linked to the Coastal Choice
 * account since Stage 1 (backfill-partners-coastal-choice.ts). Its lead is a
 * GC_BID with no BidInvitation, so the account's Bids tab and win rate do not
 * count it. This creates the invitation as already CLOSED / AWARDED at the
 * job's original contract amount, dated when the job was created, decision
 * BID with no score (it was decided before the score existed). No submission
 * row is invented: the price as sent was never recorded.
 *
 *   npx tsx scripts/backfill-partners-bid-job00009.ts           # report only
 *   npx tsx scripts/backfill-partners-bid-job00009.ts --apply   # write
 *
 * Idempotent: a lead that already has a bid is left alone. The lead's stage
 * and the job are not touched.
 */
// `--job JOB-nnnnn` points it at another job (used to test it on dev).
const jobArg = process.argv.indexOf("--job");
const JOB_NUMBER = jobArg > -1 ? process.argv[jobArg + 1]! : "JOB-00009";
const PROJECT_NAME = "Towne Place Suites Clewiston — drywall";
const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const job = await prisma.job.findUnique({ where: { jobNumber: JOB_NUMBER }, select: { id: true, jobNumber: true, title: true, contractAmount: true, originalContractAmount: true, createdAt: true, salesRepId: true, projectManagerId: true, leadId: true } });
    if (!job) {
      console.log(`${JOB_NUMBER} not found. Nothing to do.`);
      return;
    }
    const lead = await prisma.lead.findUnique({ where: { id: job.leadId }, select: { id: true, kind: true, organizationId: true, contactId: true, bidInvitation: { select: { id: true, number: true } } } });
    if (!lead) throw new Error("The job's lead is missing");
    console.log(`Job ${job.jobNumber}: ${job.title} (contract ${job.contractAmount}, original ${job.originalContractAmount ?? "—"}, created ${job.createdAt.toISOString().slice(0, 10)})`);
    console.log(`Lead ${lead.id}: kind=${lead.kind} organizationId=${lead.organizationId ?? "—"}`);
    if (lead.bidInvitation) {
      console.log(`Already has bid ${lead.bidInvitation.number} — nothing to do.`);
      return;
    }
    if (lead.kind !== "GC_BID" || !lead.organizationId) {
      console.log("The lead is not a linked GC bid yet. Run backfill-partners-coastal-choice.ts --apply first.");
      return;
    }
    const actor = job.salesRepId ?? job.projectManagerId ?? (await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
    if (!actor) throw new Error("No user to record the backfill under");
    const amount = job.originalContractAmount ?? job.contractAmount;
    console.log(`Would create: "${PROJECT_NAME}", status CLOSED, outcome AWARDED at ${amount}, decision BID (no score), dated ${job.createdAt.toISOString().slice(0, 10)}.`);
    if (!apply) {
      console.log("\nDry run — nothing written. Re-run with --apply to write.");
      return;
    }
    const bid = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('bid_invitation_number_seq') AS n`;
      const number = `BID-${String(Number(rows[0]!.n)).padStart(5, "0")}`;
      const created = await tx.bidInvitation.create({
        data: {
          leadId: lead.id,
          organizationId: lead.organizationId!,
          contactId: lead.contactId,
          number,
          projectName: PROJECT_NAME,
          projectType: "Hotel",
          status: "CLOSED",
          decision: "BID",
          decisionReason: "Recorded after the fact: the job predates bid tracking.",
          decidedAt: job.createdAt,
          decidedByUserId: actor,
          outcome: "AWARDED",
          outcomeAt: job.createdAt,
          awardedAmount: amount,
          outcomeNotes: `Backfilled from ${job.jobNumber}.`,
          signalSource: "backfill",
          createdByUserId: actor,
        },
        select: { id: true, number: true },
      });
      await tx.auditEvent.create({ data: { actorUserId: actor, entityType: "BidInvitation", entityId: created.id, action: "bid_create", afterJson: { number, leadId: lead.id, jobId: job.id, outcome: "AWARDED", awardedAmount: Number(amount), source: "backfill-partners-bid-job00009" } } });
      return created;
    });
    console.log(`Created ${bid.number} (${bid.id}). Done.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
