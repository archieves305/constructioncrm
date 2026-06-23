import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import type { ZylowPropertyRecord } from "../src/lib/services/zylow/types";
import { normalizeFromZylow } from "../src/lib/services/canvassing/normalize";
import { computeKnockScore } from "../src/lib/services/canvassing/score";
import { buildCanvasserSummary } from "../src/lib/services/canvassing/summary";
import {
  DEFAULT_COMPLIANCE_DISCLAIMER,
  DEFAULT_OPENING_SCRIPT,
  DEFAULT_SCORING_CONFIG,
} from "../src/lib/services/canvassing/scoring-config";
import { seedEstimateTemplates } from "./seed-estimate-templates";

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

  // ── Canvassing lead scoring (settings + demo scored properties) ───────────
  await prisma.canvassingSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      scoringConfigJson: DEFAULT_SCORING_CONFIG as object,
      defaultOpeningScript: DEFAULT_OPENING_SCRIPT,
      complianceDisclaimer: DEFAULT_COMPLIANCE_DISCLAIMER,
    },
  });

  // Build full Zylow-shaped records (extra fields like owner_occupied /
  // last_roof_permit_date ride along as the raw payload), then score them through
  // the real pipeline so demo numbers match production exactly. Spread across
  // tiers: Excellent → Skip, incl. one absentee and one unknown-roof-age.
  const zrec = (
    o: Partial<ZylowPropertyRecord> & Record<string, unknown> & { id: string },
  ): ZylowPropertyRecord =>
    ({
      address: null, city: null, state: "FL", zip: null, county: null,
      latitude: null, longitude: null, owner_name: null, bedrooms: null,
      bathrooms: null, sqft: null, year_built: null, property_type: null,
      roof_type: null, last_sale_date: null, last_sale_amount: null,
      outstanding_mortgages: null, estimated_value: null, cached_at: null,
      ...o,
    }) as ZylowPropertyRecord;

  const demoRecords: ZylowPropertyRecord[] = [
    zrec({
      id: "demo-excellent", address: "1423 Example St", city: "Fort Lauderdale",
      zip: "33301", owner_name: "John Smith", year_built: 1998,
      roof_type: "Asphalt Shingle", last_sale_date: "2006-05-01",
      last_sale_amount: 320000, outstanding_mortgages: 150000,
      estimated_value: 600000, owner_occupied: true,
      last_roof_permit_date: "2007-03-01", sqft: 2100, stories: 1,
    }),
    zrec({
      id: "demo-strong", address: "88 Palm Ave", city: "Pompano Beach",
      zip: "33060", owner_name: "Maria Lopez", year_built: 1992, roof_type: "Tile",
      last_sale_date: "2014-08-15", last_sale_amount: 260000,
      outstanding_mortgages: 240000, estimated_value: 480000, owner_occupied: true,
      sqft: 1850, stories: 1,
    }),
    zrec({
      id: "demo-average", address: "1200 Ocean Dr", city: "Hollywood",
      zip: "33019", owner_name: "Dan Reed", year_built: 2014,
      last_sale_date: "2015-02-01", last_sale_amount: 290000,
      outstanding_mortgages: 245000, estimated_value: 350000, owner_occupied: true,
      sqft: 1600,
    }),
    zrec({
      id: "demo-absentee", address: "5 Rental Ct", city: "Miami", zip: "33133",
      owner_name: "Acme Holdings LLC", year_built: 2018,
      mailing_address: "PO Box 900, Atlanta GA", last_sale_date: "2024-01-10",
      last_sale_amount: 295000, outstanding_mortgages: 270000,
      estimated_value: 300000, owner_occupied: false,
      last_roof_permit_date: "2023-06-01", sqft: 1400,
    }),
    zrec({
      id: "demo-unknown-roof", address: "77 Mystery Ln", city: "Davie",
      zip: "33324", owner_name: "Pat Kim", last_sale_date: "2010-09-20",
      last_sale_amount: 210000, outstanding_mortgages: 100000,
      estimated_value: 420000, sqft: 1750,
    }),
  ];

  const toDate = (s: string | null) => (s ? new Date(s) : null);
  for (const rec of demoRecords) {
    const n = normalizeFromZylow(rec);
    const result = computeKnockScore(n, DEFAULT_SCORING_CONFIG);
    const summary = buildCanvasserSummary(n, result, {
      defaultOpeningScript: DEFAULT_OPENING_SCRIPT,
      complianceDisclaimer: DEFAULT_COMPLIANCE_DISCLAIMER,
      highEquityThreshold: DEFAULT_SCORING_CONFIG.highEquityThreshold,
    });
    const data = {
      reapiId: n.reapiId, propertyAddress: n.propertyAddress, city: n.city,
      state: n.state, zip: n.zip, ownerName: n.ownerName,
      mailingAddress: n.mailingAddress, ownerOccupied: n.ownerOccupied,
      yearBuilt: n.yearBuilt, ownedSince: n.ownedSince,
      lastSaleDate: toDate(n.lastSaleDate), lastSalePrice: n.lastSalePrice,
      estimatedValue: n.estimatedValue,
      estimatedMortgageBalance: n.estimatedMortgageBalance,
      estimatedEquity: n.estimatedEquity, equityPercentage: n.equityPercentage,
      lastRoofPermitDate: toDate(n.lastRoofPermitDate),
      estimatedRoofAge: result.breakdown.roofAge.years, roofType: n.roofType,
      propertyType: n.propertyType, buildingSqft: n.buildingSqft,
      stories: n.stories, lotSizeSqft: n.lotSizeSqft, knockScore: result.score,
      knockScoreTier: result.tier, recommendedOpening: summary.recommendedOpening,
      canvasserSummaryJson: summary as object, realapiRawJson: rec as object,
      lastRealapiSyncAt: new Date(),
    };
    await prisma.canvassingProperty.upsert({
      where: { reapiId: n.reapiId },
      update: data,
      create: data,
    });
  }
  console.log(`  Canvassing: ${demoRecords.length} demo properties scored`);

  // A couple of demo prospects linked by reapiId so the Canvasser Summary button
  // shows up on the prospects list.
  for (const [reapiId, addr, city, zip, owner] of [
    ["demo-excellent", "1423 Example St", "Fort Lauderdale", "33301", "John Smith"],
    ["demo-absentee", "5 Rental Ct", "Miami", "33133", "Acme Holdings LLC"],
  ] as const) {
    const existing = await prisma.prospect.findFirst({ where: { reapiId } });
    if (!existing) {
      await prisma.prospect.create({
        data: {
          reapiId, ownerName: owner, propertyAddress1: addr, city, state: "FL",
          zipCode: zip, createdByUserId: admin.id,
        },
      });
    }
  }

  await seedEstimateTemplates(prisma);

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
