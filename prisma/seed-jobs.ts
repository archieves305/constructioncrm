import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding job stages...");

  const stages = [
    { name: "Won", stageOrder: 1 },
    { name: "Deposit Needed", stageOrder: 2 },
    { name: "Financing Cleared", stageOrder: 3 },
    { name: "Measure Complete", stageOrder: 4 },
    { name: "Scope Finalized", stageOrder: 5 },
    { name: "Permit Submitted", stageOrder: 6 },
    { name: "Permit Corrections", stageOrder: 7 },
    { name: "Permit Approved", stageOrder: 8 },
    { name: "Materials Ordered", stageOrder: 9 },
    { name: "Scheduled", stageOrder: 10 },
    { name: "In Progress", stageOrder: 11 },
    { name: "Punch List", stageOrder: 12 },
    { name: "Final Inspection", stageOrder: 13 },
    { name: "Final Payment Due", stageOrder: 14 },
    { name: "Closed", stageOrder: 15, isClosed: true },
  ];

  for (const s of stages) {
    await prisma.jobStage.upsert({
      where: { name: s.name },
      update: { stageOrder: s.stageOrder },
      create: { name: s.name, stageOrder: s.stageOrder, isClosed: s.isClosed || false },
    });
  }
  console.log(`  ${stages.length} job stages seeded`);

  // Seed some crews
  const crews = [
    { name: "Alpha Roofing Crew", trades: ["Roofing"] },
    { name: "Bravo Windows Crew", trades: ["Windows"] },
    { name: "Charlie Doors Crew", trades: ["Doors"] },
    { name: "Delta Interior Crew", trades: ["Interior Renovations"] },
    { name: "Echo Drywall Crew", trades: ["Drywall"] },
  ];

  for (const c of crews) {
    const existing = await prisma.crew.findFirst({ where: { name: c.name } });
    if (!existing) {
      await prisma.crew.create({ data: c });
    }
  }
  console.log(`  ${crews.length} crews seeded`);

  console.log("Job seeding complete!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
