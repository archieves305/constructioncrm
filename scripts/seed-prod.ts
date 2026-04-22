import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Production reference-data seed.
//
// Subset of prisma/seed.ts: roles, lead stages, lead sources, service
// categories, plus job stages and crews from prisma/seed-jobs.ts.
//
// DOES NOT seed any User rows. The original prisma/seed.ts seeds three demo
// users with hardcoded passwords (admin123 / rep123 / mgr123) which must
// NEVER run against production. Use scripts/create-admin.ts to create the
// initial admin user with a generated password instead.
//
// Idempotent: every insert is gated by upsert or findFirst+create.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function seedRoles() {
  const roles = [
    { name: "ADMIN" as const, description: "Full system access" },
    { name: "MANAGER" as const, description: "Team and pipeline management" },
    { name: "SALES_REP" as const, description: "Own leads and tasks" },
    { name: "OFFICE_STAFF" as const, description: "Lead intake and data entry" },
    { name: "MARKETING" as const, description: "View reports and source data" },
    { name: "READ_ONLY" as const, description: "View-only access" },
  ];
  for (const r of roles) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: r,
    });
  }
  console.log(`  ${roles.length} roles seeded`);
}

async function seedLeadStages() {
  const stages = [
    { name: "New Lead", stageOrder: 1, isClosed: false, isWon: false, isLost: false },
    { name: "Contact Attempted", stageOrder: 2, isClosed: false, isWon: false, isLost: false },
    { name: "Contacted", stageOrder: 3, isClosed: false, isWon: false, isLost: false },
    { name: "Appointment Scheduled", stageOrder: 4, isClosed: false, isWon: false, isLost: false },
    { name: "Inspection Completed", stageOrder: 5, isClosed: false, isWon: false, isLost: false },
    { name: "Estimate Sent", stageOrder: 6, isClosed: false, isWon: false, isLost: false },
    { name: "Follow-Up Needed", stageOrder: 7, isClosed: false, isWon: false, isLost: false },
    { name: "Negotiation", stageOrder: 8, isClosed: false, isWon: false, isLost: false },
    { name: "Won", stageOrder: 9, isClosed: true, isWon: true, isLost: false },
    { name: "Lost", stageOrder: 10, isClosed: true, isWon: false, isLost: true },
    { name: "On Hold", stageOrder: 11, isClosed: false, isWon: false, isLost: false },
  ];
  for (const s of stages) {
    await prisma.leadStage.upsert({
      where: { name: s.name },
      update: {
        stageOrder: s.stageOrder,
        isClosed: s.isClosed,
        isWon: s.isWon,
        isLost: s.isLost,
      },
      create: s,
    });
  }
  console.log(`  ${stages.length} lead stages seeded`);
}

async function seedLeadSources() {
  const sources = [
    { name: "Google Ads", channelType: "PAID" as const },
    { name: "Website", channelType: "ORGANIC" as const },
    { name: "Referral", channelType: "REFERRAL" as const },
    { name: "Google Business Profile", channelType: "ORGANIC" as const },
    { name: "Facebook", channelType: "SOCIAL" as const },
    { name: "Instagram", channelType: "SOCIAL" as const },
    { name: "Door Knocking", channelType: "DIRECT" as const },
    { name: "Manual Entry", channelType: "OTHER" as const },
    { name: "Phone Call", channelType: "DIRECT" as const },
    { name: "Yard Sign", channelType: "DIRECT" as const },
  ];
  // LeadSource.name is NOT unique in the schema (sources can have parents);
  // use findFirst + create to keep idempotent.
  for (const s of sources) {
    const existing = await prisma.leadSource.findFirst({
      where: { name: s.name, parentId: null },
    });
    if (!existing) {
      await prisma.leadSource.create({ data: s });
    }
  }
  console.log(`  ${sources.length} lead sources seeded`);
}

async function seedServiceCategories() {
  const tree: { name: string; children?: string[] }[] = [
    { name: "Roofing", children: ["Roof Repair", "Roof Replacement", "Roof Inspection"] },
    { name: "Windows", children: ["Impact Windows", "Standard Windows", "Window Repair"] },
    { name: "Doors", children: ["Impact Doors", "Entry Doors", "Sliding Doors"] },
    { name: "Drywall", children: ["Drywall Repair", "Drywall Replacement", "Drywall Installation"] },
    {
      name: "Interior Renovations",
      children: ["Kitchen Remodel", "Bathroom Remodel", "Flooring", "Painting"],
    },
  ];
  let count = 0;
  let sortOrder = 0;
  for (const parent of tree) {
    const existingParent = await prisma.serviceCategory.findFirst({
      where: { name: parent.name, parentId: null },
    });
    const parentRecord =
      existingParent ??
      (await prisma.serviceCategory.create({
        data: { name: parent.name, sortOrder: sortOrder++ },
      }));
    count++;
    if (parent.children) {
      for (const childName of parent.children) {
        const existingChild = await prisma.serviceCategory.findFirst({
          where: { name: childName, parentId: parentRecord.id },
        });
        if (!existingChild) {
          await prisma.serviceCategory.create({
            data: { name: childName, parentId: parentRecord.id, sortOrder: sortOrder++ },
          });
        }
        count++;
      }
    }
  }
  console.log(`  ${count} service categories seeded`);
}

async function seedJobStages() {
  const stages: { name: string; stageOrder: number; isClosed?: boolean }[] = [
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
      create: { name: s.name, stageOrder: s.stageOrder, isClosed: s.isClosed ?? false },
    });
  }
  console.log(`  ${stages.length} job stages seeded`);
}

async function seedCrews() {
  const crews = [
    { name: "Alpha Roofing Crew", tradeType: "Roofing" },
    { name: "Bravo Windows Crew", tradeType: "Windows" },
    { name: "Charlie Doors Crew", tradeType: "Doors" },
    { name: "Delta Interior Crew", tradeType: "Interior Renovations" },
    { name: "Echo Drywall Crew", tradeType: "Drywall" },
  ];
  for (const c of crews) {
    const existing = await prisma.crew.findFirst({ where: { name: c.name } });
    if (!existing) {
      await prisma.crew.create({ data: c });
    }
  }
  console.log(`  ${crews.length} crews seeded`);
}

async function main() {
  console.log("Seeding production reference data (NO users)...");
  await seedRoles();
  await seedLeadStages();
  await seedLeadSources();
  await seedServiceCategories();
  await seedJobStages();
  await seedCrews();
  console.log(
    "Done. No demo users created. Use scripts/create-admin.ts to add the initial admin.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
