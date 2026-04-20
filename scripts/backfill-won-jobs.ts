import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const wonLeads = await prisma.lead.findMany({
    where: { currentStage: { isWon: true } },
    include: { services: { include: { serviceCategory: true } } },
  });

  let created = 0;
  for (const lead of wonLeads) {
    const existing = await prisma.job.findFirst({ where: { leadId: lead.id } });
    if (existing) continue;

    const depositStage = await prisma.jobStage.findFirst({
      where: { name: "Deposit Needed" },
    });
    const wonStage = await prisma.jobStage.findFirst({ where: { name: "Won" } });
    if (!depositStage || !wonStage) throw new Error("Job stages missing");

    const last = await prisma.job.findFirst({
      orderBy: { createdAt: "desc" },
      select: { jobNumber: true },
    });
    const nextN = last ? parseInt(last.jobNumber.replace("JOB-", ""), 10) + 1 : 1;
    const serviceType =
      lead.services.map((s) => s.serviceCategory.name).join(", ") || "General";
    const contractAmount = lead.estimatedJobValue || 0;
    const depositRequired = Number(contractAmount) * 0.5;

    const job = await prisma.job.create({
      data: {
        leadId: lead.id,
        jobNumber: `JOB-${String(nextN).padStart(5, "0")}`,
        title: `${serviceType} — ${lead.fullName}`,
        serviceType,
        contractAmount,
        depositRequired,
        balanceDue: contractAmount,
        salesRepId: lead.assignedUserId,
        currentStageId: depositStage.id,
        nextAction: "Collect deposit",
        financingRequired: lead.financingNeeded,
        financingStatus: lead.financingNeeded ? "PENDING_APPLICATION" : "NOT_NEEDED",
      },
    });

    await prisma.jobStageHistory.create({
      data: {
        jobId: job.id,
        toStageId: job.currentStageId,
        changedByUserId: lead.createdByUserId,
      },
    });

    created += 1;
    console.log(`  Backfilled ${job.jobNumber} for lead ${lead.fullName}`);
  }

  console.log(`Done. ${created} jobs created.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
