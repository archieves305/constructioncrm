import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { recomputeJobBalance } from "../src/lib/services/job-pricing";

// One-off import: two Carey Real Estate Holdings, LLC new-construction homes
// in Navarre, FL. Sources: jobimports/"2188 Draw Request (1).xlsx" and
// jobimports/"2192 Wind trace draw schedule (2).xlsx" (bank draw schedules).
// Each draw line becomes a BudgetLine so the job's Budget panel can
// cross-reference budget vs. actual (expenses / labor allocations).
// Run: npx tsx scripts/import-navarre-newcon.ts
//
// Notes preserved from the source sheets:
// - 2188: schedule totals $233,883.00 (percent-based). The sheet header also
//   says "Initial 10% draw = $25,987" — consistent with a $259,870 total of
//   which $233,883 is the remaining 90%. Contract recorded as $233,883 to
//   match the schedule; adjust if the initial draw should be added on top.
// - 2192: the "new request" (revised) column is used. Its cent-rounded lines
//   sum to $205,885.87 vs the sheet's stated $205,885.80 total (7¢ of
//   spreadsheet rounding); line values kept verbatim, contract $205,885.80.
// - Landscaping on 2192 is annotated "half" in the sheet.
//
// Idempotence: aborts if a job for either property already exists.

const NAVARRE = { city: "Navarre", state: "FL", zipCode: "32566" };

type Line = { category: string; name: string };

// Shared draw-schedule template (names de-mangled from the PDF-extracted
// spreadsheet text). Zero-amount lines are skipped per job.
const LINES: Line[] = [
  { category: "Site & Foundation", name: "Permits & Utilities" },
  { category: "Site & Foundation", name: "Backfill and Pad" },
  { category: "Site & Foundation", name: "Footings Poured / Foundation" },
  { category: "Rough-Ins", name: "Plumbing: Roughed In" },
  { category: "Site & Foundation", name: "Slab Poured" },
  { category: "Framing & Shell", name: "Wall Framing — Materials & Labor: Outside Studs; Inside Studs; Wall Sheathing" },
  { category: "Framing & Shell", name: "Roof Framing: Sheathing; Paper" },
  { category: "Framing & Shell", name: "Roof" },
  { category: "Framing & Shell", name: "Fireplace and Chimney" },
  { category: "Rough-Ins", name: "Electrical: Rough In" },
  { category: "Rough-Ins", name: "HVAC: Ducts; Insulation; Wiring" },
  { category: "Exterior", name: "Exterior Windows" },
  { category: "Exterior", name: "Exterior Doors" },
  { category: "Exterior", name: "Exterior Siding" },
  { category: "Exterior", name: "Garage Doors" },
  { category: "Rough-Ins", name: "Plumbing: Stack Out" },
  { category: "Rough-Ins", name: "Insulation" },
  { category: "Rough-Ins", name: "Heat: Furnace" },
  { category: "Interior", name: "Interior Walls and Ceilings: Sheetrock Installed & Finished" },
  { category: "Interior", name: "Interior Paint Primed" },
  { category: "Interior", name: "Cabinets: Kitchen & Bath" },
  { category: "Interior", name: "Countertops: Kitchen & Bath" },
  { category: "Interior", name: "Interior Doors (including hardware)" },
  { category: "Interior", name: "Interior Trim: Shelves; Doors; Base; Closets" },
  { category: "Interior", name: "Bath Tile (including floor)" },
  { category: "Finish", name: "Plumbing Finished (excludes fixtures) — includes septic" },
  { category: "Finish", name: "Plumbing Fixtures" },
  { category: "Exterior", name: "Hurricane Shutters" },
  { category: "Finish", name: "Interior Painting Complete" },
  { category: "Exterior", name: "Exterior Painting Complete" },
  { category: "Finish", name: "Electrical Finished (excludes fixtures)" },
  { category: "Finish", name: "Lighting Fixtures" },
  { category: "Finish", name: "Floor Covering" },
  { category: "Exterior", name: "Deck" },
  { category: "Finish", name: "Appliances (installed)" },
  { category: "Finish", name: "Air Conditioning Compressor" },
  { category: "Completion", name: "Outside Concrete; Driveway; Walks" },
  { category: "Completion", name: "Landscaping (Finish Grade)" },
  { category: "Completion", name: "Clean — Final" },
];

// 2188: draw % of $233,883 (percentages sum to exactly 1.0). Amounts are
// computed and cent-rounded; the last nonzero line absorbs rounding so the
// budget totals exactly $233,883.00.
const PCT_2188: number[] = [
  0.065, 0.02, 0.05, 0.025, 0.05, 0.085, 0.06, 0.03, 0, 0.04, 0.03, 0.03,
  0.03, 0.07, 0, 0.025, 0.015, 0, 0.04, 0.01, 0.035, 0.025, 0.02, 0.02,
  0.02, 0.03, 0.005, 0.01, 0.01, 0.025, 0.035, 0.005, 0.03, 0, 0.01, 0.015,
  0.01, 0.01, 0.01,
];
const TOTAL_2188 = 233_883.0;

// 2192: revised "new request" dollar amounts, verbatim from the sheet.
const AMT_2192: number[] = [
  4_117.72, 4_117.72, 8_235.43, 6_176.57, 12_353.15, 18_529.72, 13_382.58,
  8_235.43, 0, 8_235.43, 8_235.43, 5_147.15, 5_147.15, 14_412.01, 2_058.86,
  4_117.72, 3_088.29, 0, 8_235.43, 2_058.86, 8_235.43, 6_176.57, 4_117.72,
  4_117.72, 4_117.72, 4_117.72, 3_088.29, 3_088.29, 3_088.29, 4_117.72,
  5_147.15, 2_058.86, 5_147.15, 0, 2_058.86, 5_147.15, 3_088.29, 2_058.86,
  1_029.43,
];
const TOTAL_2192 = 205_885.8;

const round2 = (n: number) => Math.round(n * 100) / 100;

function amounts2188(): number[] {
  if (PCT_2188.length !== LINES.length) throw new Error("2188 pct/line count mismatch");
  const amounts = PCT_2188.map((p) => round2(p * TOTAL_2188));
  const sum = round2(amounts.reduce((s, a) => s + a, 0));
  const delta = round2(TOTAL_2188 - sum);
  if (Math.abs(delta) > 1) throw new Error(`2188 rounding delta too large: ${delta}`);
  // absorb rounding into the last nonzero line (Clean — Final)
  const last = amounts.length - 1;
  amounts[last] = round2(amounts[last] + delta);
  return amounts;
}

const JOBS = [
  {
    key: "2188",
    title: "2188 — New Construction (Navarre)",
    // Street name not in the draw-schedule file — confirm with Richard.
    address1: "2188 (street TBD)",
    contract: TOTAL_2188,
    amounts: amounts2188(),
    leadNotes:
      "Owner entity for the 2188 new-construction home in Navarre, FL. Imported 2026-07-07 from the bank draw schedule (jobimports/2188 Draw Request). Sheet notes \"Initial 10% draw = $25,987\" — implies a $259,870 total of which the $233,883 schedule is the remaining 90%. Street address and phone TBD.",
  },
  {
    key: "2192 Wind Trace",
    title: "2192 Wind Trace — New Construction (Navarre)",
    address1: "2192 Wind Trace",
    contract: TOTAL_2192,
    amounts: AMT_2192,
    leadNotes:
      "Owner entity for the 2192 Wind Trace new-construction home in Navarre, FL. Imported 2026-07-07 from the bank draw schedule (jobimports/2192 Wind trace draw schedule), using the revised \"new request\" column. Landscaping line is annotated \"half\" in the sheet. Phone TBD.",
  },
];

async function main() {
  for (const j of JOBS) {
    const existing = await prisma.job.findFirst({
      where: { title: { contains: j.key } },
      select: { jobNumber: true },
    });
    if (existing) {
      console.error(`ABORT: job ${existing.jobNumber} already contains "${j.key}"`);
      process.exit(1);
    }
  }

  const creator = await prisma.user.findUnique({
    where: { email: "richard@rcareylaw.com" },
    select: { id: true },
  });
  if (!creator) {
    console.error("ABORT: creator user richard@rcareylaw.com not found");
    process.exit(1);
  }

  const wonStage = await prisma.leadStage.findUnique({ where: { name: "Won" } });
  const jobStage = await prisma.jobStage.findUnique({ where: { name: "In Progress" } });
  const source = await prisma.leadSource.findFirst({ where: { name: "Manual Entry" } });
  if (!wonStage || !jobStage) {
    console.error("ABORT: required stages missing (Won / In Progress)");
    process.exit(1);
  }

  // Next job number from max suffix (same rule as the app).
  const jobs = await prisma.job.findMany({ select: { jobNumber: true } });
  let maxSuffix = jobs.reduce((m, x) => {
    const n = Number(x.jobNumber.replace(/^JOB-/, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);

  for (const j of JOBS) {
    const lead = await prisma.lead.create({
      data: {
        firstName: "Carey Real Estate",
        lastName: "Holdings, LLC",
        fullName: "Carey Real Estate Holdings, LLC",
        companyName: "Carey Real Estate Holdings, LLC",
        primaryPhone: "TBD",
        propertyAddress1: j.address1,
        ...NAVARRE,
        propertyType: "RESIDENTIAL",
        residentialCommercial: "Residential",
        currentStageId: wonStage.id,
        sourceId: source?.id ?? null,
        createdByUserId: creator.id,
        notesSummary: j.leadNotes,
      },
    });

    maxSuffix += 1;
    const jobNumber = `JOB-${String(maxSuffix).padStart(5, "0")}`;
    const job = await prisma.job.create({
      data: {
        leadId: lead.id,
        jobNumber,
        title: j.title,
        serviceType: "New Construction",
        jobType: "FIXED_PRICE",
        contractAmount: j.contract,
        currentStageId: jobStage.id,
        nextAction: "Confirm street address/contact; link expenses to budget lines as costs come in",
      },
    });

    if (j.amounts.length !== LINES.length) throw new Error(`${j.key}: amount/line count mismatch`);
    const rows = LINES.map((l, i) => ({
      jobId: job.id,
      category: l.category,
      name: l.name,
      amount: j.amounts[i],
      sortOrder: i,
    })).filter((r) => r.amount > 0);
    await prisma.budgetLine.createMany({ data: rows });

    await recomputeJobBalance(job.id);

    const total = j.amounts.reduce((s, a) => s + a, 0);
    console.log(`${job.jobNumber}  ${job.title}`);
    console.log(`  contract: $${j.contract.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`  budget lines: ${rows.length} (skipped ${LINES.length - rows.length} zero lines), total $${round2(total).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  }

  await prisma.$disconnect();
}

main();
