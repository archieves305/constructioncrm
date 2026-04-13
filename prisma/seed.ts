import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL!;
console.log("Connecting to:", connectionString.replace(/\/\/.*@/, "//***@"));
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // ── Roles ───────────────────────────────────────────────────────────────
  const roles = await Promise.all(
    [
      { name: "ADMIN" as const, description: "Full system access" },
      { name: "MANAGER" as const, description: "Team and pipeline management" },
      { name: "SALES_REP" as const, description: "Own leads and tasks" },
      { name: "OFFICE_STAFF" as const, description: "Lead intake and data entry" },
      { name: "MARKETING" as const, description: "View reports and source data" },
      { name: "READ_ONLY" as const, description: "View-only access" },
    ].map((r) =>
      prisma.role.upsert({
        where: { name: r.name },
        update: {},
        create: r,
      })
    )
  );
  console.log(`  ${roles.length} roles seeded`);

  // ── Lead Stages ─────────────────────────────────────────────────────────
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
  const seededStages = await Promise.all(
    stages.map((s) =>
      prisma.leadStage.upsert({
        where: { name: s.name },
        update: { stageOrder: s.stageOrder, isClosed: s.isClosed, isWon: s.isWon, isLost: s.isLost },
        create: s,
      })
    )
  );
  console.log(`  ${seededStages.length} stages seeded`);

  // ── Lead Sources ────────────────────────────────────────────────────────
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
  let sourceCount = 0;
  for (const s of sources) {
    await prisma.leadSource.upsert({
      where: { id: s.name }, // will fail on first run, creates instead
      update: {},
      create: s,
    }).catch(() =>
      prisma.leadSource.create({ data: s })
    );
    sourceCount++;
  }
  console.log(`  ${sourceCount} sources seeded`);

  // ── Service Categories ──────────────────────────────────────────────────
  const serviceData: { name: string; children?: string[] }[] = [
    { name: "Roofing", children: ["Roof Repair", "Roof Replacement", "Roof Inspection"] },
    { name: "Windows", children: ["Impact Windows", "Standard Windows", "Window Repair"] },
    { name: "Doors", children: ["Impact Doors", "Entry Doors", "Sliding Doors"] },
    { name: "Drywall", children: ["Drywall Repair", "Drywall Replacement", "Drywall Installation"] },
    {
      name: "Interior Renovations",
      children: ["Kitchen Remodel", "Bathroom Remodel", "Flooring", "Painting"],
    },
  ];
  let serviceCount = 0;
  for (const parent of serviceData) {
    const created = await prisma.serviceCategory.create({
      data: { name: parent.name, sortOrder: serviceCount },
    }).catch(() => prisma.serviceCategory.findFirst({ where: { name: parent.name, parentId: null } }));

    if (created && parent.children) {
      for (const childName of parent.children) {
        serviceCount++;
        await prisma.serviceCategory.create({
          data: { name: childName, parentId: created.id, sortOrder: serviceCount },
        }).catch(() => {});
      }
    }
    serviceCount++;
  }
  console.log(`  ${serviceCount} service categories seeded`);

  // ── Default Admin User ──────────────────────────────────────────────────
  const adminRole = roles.find((r) => r.name === "ADMIN")!;
  const hashedPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@constructioncrm.com" },
    update: {},
    create: {
      firstName: "System",
      lastName: "Admin",
      email: "admin@constructioncrm.com",
      passwordHash: hashedPassword,
      roleId: adminRole.id,
    },
  });
  console.log(`  Admin user seeded: ${admin.email}`);

  // ── Demo Sales Rep ──────────────────────────────────────────────────────
  const repRole = roles.find((r) => r.name === "SALES_REP")!;
  const repPassword = await bcrypt.hash("rep123", 12);
  const rep = await prisma.user.upsert({
    where: { email: "john.rep@constructioncrm.com" },
    update: {},
    create: {
      firstName: "John",
      lastName: "Sales",
      email: "john.rep@constructioncrm.com",
      passwordHash: repPassword,
      roleId: repRole.id,
    },
  });
  console.log(`  Demo rep seeded: ${rep.email}`);

  // ── Demo Manager ────────────────────────────────────────────────────────
  const mgrRole = roles.find((r) => r.name === "MANAGER")!;
  const mgrPassword = await bcrypt.hash("mgr123", 12);
  const mgr = await prisma.user.upsert({
    where: { email: "sarah.mgr@constructioncrm.com" },
    update: {},
    create: {
      firstName: "Sarah",
      lastName: "Manager",
      email: "sarah.mgr@constructioncrm.com",
      passwordHash: mgrPassword,
      roleId: mgrRole.id,
    },
  });
  console.log(`  Demo manager seeded: ${mgr.email}`);

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
