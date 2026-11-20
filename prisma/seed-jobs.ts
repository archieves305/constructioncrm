import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { STAGE_SEED } from "../src/lib/jobs/stage-kinds";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding job stages...");

  // Client jobs, flips and rentals each have their own list (src/lib/jobs/stage-kinds.ts).
  const stages = STAGE_SEED;

  for (const s of stages) {
    await prisma.jobStage.upsert({
      where: { name: s.name },
      update: { stageOrder: s.stageOrder, kinds: [...s.kinds] },
      create: { name: s.name, stageOrder: s.stageOrder, isClosed: s.isClosed || false, kinds: [...s.kinds] },
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
