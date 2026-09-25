import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Dev-only: remove the QA rows the contract feature's browser/API QA left on
 * the dev database, and put the seeded template back to a single published
 * v1. Refuses to run against anything but localhost.
 *
 *   npx tsx scripts/qa-cleanup-contracts.ts
 */
const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Refusing: DATABASE_URL is not a local database");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const estimates = await prisma.estimate.findMany({ where: { name: { startsWith: "QA:" } }, select: { id: true, estimateNumber: true } });
  const contracts = await prisma.customerContract.findMany({ where: { OR: [{ estimateId: { in: estimates.map((e) => e.id) } }, { estimate: null, roofEstimate: null }] }, select: { id: true, contractNumber: true } });
  const contractIds = contracts.map((c) => c.id);

  const docs = await prisma.generatedDocument.findMany({ where: { customerContractId: { in: contractIds } }, select: { id: true, fileId: true } });
  const fileIds = docs.map((d) => d.fileId).filter((id): id is string => Boolean(id));
  await prisma.generatedDocument.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  await prisma.file.deleteMany({ where: { id: { in: fileIds } } });
  const tasks = await prisma.task.deleteMany({ where: { OR: [{ sourceKey: { in: contractIds.map((id) => `customer-contract:SENT:${id}`) } }, { title: { contains: "Reconcile schedule of values with signed contract" } }] } });
  const audits = await prisma.auditEvent.deleteMany({ where: { entityType: "CustomerContract", entityId: { in: contractIds } } });
  const activity = await prisma.activityLog.deleteMany({ where: { OR: contracts.map((c) => ({ title: { contains: c.contractNumber } })) } });
  await prisma.customerContract.deleteMany({ where: { id: { in: contractIds } } });
  const estTasks = await prisma.task.deleteMany({ where: { estimateId: { in: estimates.map((e) => e.id) } } });
  await prisma.estimate.deleteMany({ where: { id: { in: estimates.map((e) => e.id) } } });
  const estFiles = await prisma.file.deleteMany({ where: { OR: estimates.map((e) => ({ fileName: { contains: e.estimateNumber } })) } });

  // Template: back to one published v1.
  const t = await prisma.contractTemplate.findUnique({ where: { key: "residential_construction" }, include: { versions: true } });
  if (t) {
    await prisma.contractTemplateVersion.deleteMany({ where: { templateId: t.id, version: { gt: 1 } } });
    await prisma.contractTemplateVersion.updateMany({ where: { templateId: t.id, version: 1 }, data: { status: "PUBLISHED", supersededAt: null } });
    await prisma.auditEvent.deleteMany({ where: { entityType: { in: ["ContractTemplateVersion", "ContractTemplate"] } } });
  }
  // JOB-00001 was the QA job: restore its pre-QA contract amount.
  const job = await prisma.job.findUnique({ where: { jobNumber: "JOB-00001" }, select: { id: true } });
  if (job) await prisma.job.update({ where: { id: job.id }, data: { contractAmount: 30000, depositRequired: 15000, balanceDue: 22000 } });

  console.log({ contracts: contracts.map((c) => c.contractNumber), estimates: estimates.map((e) => e.estimateNumber), docs: docs.length, files: fileIds.length + estFiles.count, tasks: tasks.count + estTasks.count, audits: audits.count, activity: activity.count });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
