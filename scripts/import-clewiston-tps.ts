import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { recomputeJobBalance } from "../src/lib/services/job-pricing";

// One-off import: Towne Place Suites Clewiston (Marriott) — drywall/framing
// package for GC Coastal Choice Construction. Sources: AIA G702 payment
// applications 1–11 (PDFs) and the per-application P&L workbook (through
// App 14 / May 2026). Run: npx tsx scripts/import-clewiston-tps.ts
//
// Idempotence: aborts if a job titled "Towne Place Suites" already exists.

const CONTRACT_DATE = new Date("2025-03-07T00:00:00Z");

// [app, amount, periodTo, paidDate|null] — paidDate from the workbook's
// "Deposited" column where recorded; apps 1/7/8 were PAID per the documents
// but lack an exact deposit date (approximation noted on the record).
const APPLICATIONS: [number, number, string, string | null, string | null][] = [
  //  #   amount      period-to     paid (deposited)  note
  [1, 31_500.0, "2025-04-30", "2025-05-30", "Paid per application PDF; exact deposit date not recorded (approx.)"],
  [2, 38_520.0, "2025-05-31", "2025-06-26", null],
  [3, 73_303.2, "2025-06-30", "2025-07-29", null],
  [4, 87_449.4, "2025-07-31", "2025-08-27", null],
  [5, 63_165.6, "2025-08-30", "2025-10-03", null],
  [6, 51_978.6, "2025-09-30", "2025-11-14", null],
  [7, 19_054.8, "2025-10-31", "2025-12-24", "Deposit date approximated from the 12/24/2025 project-sheet reconciliation"],
  [8, 29_959.2, "2025-11-30", "2025-12-24", "Deposit date approximated from the 12/24/2025 project-sheet reconciliation"],
  [9, 64_218.6, "2025-12-31", "2026-02-24", null],
  [10, 25_598.7, "2026-01-31", null, "Project sheet suggests collected (~Apr 2026) but no deposit date recorded — left outstanding for Richard to confirm"],
  [11, 29_250.0, "2026-02-28", null, "DUE per application PDF"],
  [12, 32_688.0, "2026-03-31", null, "From project sheet (no PDF in folder); no deposit date recorded"],
];

// Aggregated costs per reconciliation period from the P&L workbook.
// [incurredDate, vendor, type, amount, description]
const EXPENSES: [string, string, "MATERIAL" | "LABOR", number, string][] = [
  ["2025-08-28", "Banner Supply", "MATERIAL", 81_881.29, "Materials — Apps 2–4 period (per project sheet 8/28/2025)"],
  ["2025-10-03", "Banner Supply", "MATERIAL", 38_727.7, "Materials — App 5 period"],
  ["2025-11-14", "Banner Supply", "MATERIAL", 11_246.45, "Materials — App 6 period"],
  ["2025-12-24", "Banner Supply", "MATERIAL", 14_037.24, "Materials — Apps 7–8 period"],
  ["2026-02-24", "Banner Supply", "MATERIAL", 38_721.81, "Materials — App 9 period"],
  ["2026-01-31", "Banner Supply", "MATERIAL", 11_746.32, "Materials — App 10 period"],
  ["2026-02-28", "Banner Supply", "MATERIAL", 20_047.7, "Materials — App 11 period"],
  ["2026-03-31", "Banner Supply", "MATERIAL", 29_857.11, "Materials — App 12 period"],
  ["2025-08-28", "Crew labor", "LABOR", 42_196.77, "Crew labor payments — Apps 2–4 period (per project sheet)"],
  ["2025-10-03", "Crew labor", "LABOR", 13_723.2, "Crew labor payments — App 5 period"],
  ["2025-11-14", "Crew labor", "LABOR", 8_638.9, "Crew labor payments — App 6 period"],
  ["2025-12-24", "Crew labor", "LABOR", 8_272.0, "Crew labor payments — Apps 7–8 period"],
  ["2026-02-24", "Crew labor", "LABOR", 12_713.0, "Crew labor payments — App 9 period"],
  ["2026-01-31", "Crew labor", "LABOR", 5_608.4, "Crew labor payments — App 10 period"],
  ["2026-02-28", "Crew labor", "LABOR", 8_771.1, "Crew labor payments — App 11 period"],
  ["2026-03-31", "Crew labor", "LABOR", 4_625.3, "Crew labor payments — App 12 period"],
  ["2026-04-30", "Crew labor", "LABOR", 7_374.0, "Crew labor payments — App 13 period (Roberto Rodriguez, April 2026)"],
  ["2025-08-28", "Frank Picado", "LABOR", 10_160.0, "Supervision — Apps 2–4 (net of retainage)"],
  ["2025-10-03", "Frank Picado", "LABOR", 3_600.0, "Supervision — App 5"],
  ["2025-11-14", "Frank Picado", "LABOR", 5_400.0, "Supervision — App 6"],
  ["2025-12-24", "Frank Picado", "LABOR", 9_450.0, "Supervision — Apps 7–8"],
  ["2026-02-24", "Frank Picado", "LABOR", 5_400.0, "Supervision — App 9"],
  ["2026-01-31", "Frank Picado", "LABOR", 5_400.0, "Supervision — App 10"],
  ["2026-02-28", "Frank Picado", "LABOR", 5_400.0, "Supervision — App 11"],
  ["2026-03-31", "Frank Picado", "LABOR", 3_600.0, "Supervision — App 12"],
];

const PERSONNEL: {
  firstName: string;
  lastName: string;
  trade: string;
  title: string | null;
  notes: string;
}[] = [
  {
    firstName: "Frank",
    lastName: "Picado",
    trade: "Drywall",
    title: "Crew Manager",
    notes:
      "Crew manager on Towne Place Suites Clewiston. Supervision billed ~$4,000/application (paid net of 10% retainage) plus 50/50 profit split with Richard per the project sheet. Needs a CREW_LEAD login for Field Mode — ask Richard for his email.",
  },
  {
    firstName: "Roberto",
    lastName: "Rodriguez",
    trade: "Drywall",
    title: null,
    notes: "Crew on Towne Place Suites Clewiston (per project-sheet labor payments). Hourly rate not on file yet.",
  },
  {
    firstName: "Alvaro",
    lastName: "Angulo",
    trade: "Drywall",
    title: null,
    notes: "Crew on Towne Place Suites Clewiston (per project-sheet labor payments). Hourly rate not on file yet.",
  },
];

const FLOORS = ["Floor 1", "Floor 2", "Floor 3", "Floor 4"];

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

async function main() {
  const existing = await prisma.job.findFirst({
    where: { title: { contains: "Towne Place Suites" } },
    select: { id: true, jobNumber: true },
  });
  if (existing) {
    console.error(`ABORT: job ${existing.jobNumber} already contains "Towne Place Suites"`);
    process.exit(1);
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
  const maxSuffix = jobs.reduce((m, j) => {
    const n = Number(j.jobNumber.replace(/^JOB-/, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  const jobNumber = `JOB-${String(maxSuffix + 1).padStart(5, "0")}`;
  const jobSuffix = jobNumber.replace(/^JOB-/, "");

  const lead = await prisma.lead.create({
    data: {
      firstName: "Coastal Choice",
      lastName: "Construction",
      fullName: "Coastal Choice Construction",
      companyName: "Coastal Choice Construction",
      primaryPhone: "TBD",
      propertyAddress1: "TownePlace Suites by Marriott",
      city: "Clewiston",
      state: "FL",
      zipCode: "33440",
      mailingAddress1: "3170 North Federal Highway",
      mailingAddress2: "Lighthouse Point, FL 33064",
      propertyType: "COMMERCIAL",
      residentialCommercial: "Commercial",
      currentStageId: wonStage.id,
      sourceId: source?.id ?? null,
      createdByUserId: creator.id,
      notesSummary:
        "GC for the TownePlace Suites hotel project in Clewiston. Contract dated 3/7/2025. Imported 2026-07-03 from AIA payment applications 1–11 + project P&L sheet. Phone/email TBD.",
    },
  });
  console.log(`lead: ${lead.id} (${lead.fullName})`);

  const job = await prisma.job.create({
    data: {
      leadId: lead.id,
      jobNumber,
      title: "Towne Place Suites Clewiston — Drywall, Framing & Ceilings",
      serviceType: "Drywall",
      jobType: "FIXED_PRICE",
      // $830,000 base + $2,500 CO#1 (added framing materials) per App 11 G702
      contractAmount: 832_500,
      currentStageId: jobStage.id,
      targetStartDate: CONTRACT_DATE,
      nextAction: "Collect Apps 10–12; bill Apps 13–14; onboard Frank Picado to Field Mode",
      createdAt: CONTRACT_DATE,
    },
  });
  console.log(`job: ${job.jobNumber} — ${job.title}`);

  // Invoices (payment applications) + received payments
  for (const [num, amount, periodTo, paidDate, note] of APPLICATIONS) {
    const invoice = await prisma.invoice.create({
      data: {
        jobId: job.id,
        invoiceNumber: `INV-${jobSuffix}-${num}`,
        issueDate: d(periodTo),
        amount,
        status: paidDate ? "PAID" : "SENT",
        paidAt: paidDate ? d(paidDate) : null,
        notes: [
          `AIA G702 Payment Application #${num} (period to ${periodTo}). 10% retainage withheld by GC (retainage not included in this amount).`,
          note,
        ]
          .filter(Boolean)
          .join(" "),
      },
    });
    if (paidDate) {
      await prisma.payment.create({
        data: {
          jobId: job.id,
          invoiceId: invoice.id,
          paymentType: "PROGRESS",
          method: "CHECK",
          amount,
          status: "RECEIVED",
          receivedDate: d(paidDate),
          notes: `Payment Application #${num}`,
        },
      });
    }
    console.log(`  app ${num}: $${amount.toLocaleString()} ${paidDate ? "PAID " + paidDate : "OUTSTANDING"}`);
  }

  // Costs per the P&L workbook
  for (const [date, vendor, type, amount, description] of EXPENSES) {
    await prisma.jobExpense.create({
      data: {
        jobId: job.id,
        type,
        vendor,
        description,
        amount,
        incurredDate: d(date),
        createdByUserId: creator.id,
      },
    });
  }
  console.log(`expenses: ${EXPENSES.length} records`);

  // Hotel floors for daily-log area tracking
  for (let i = 0; i < FLOORS.length; i++) {
    await prisma.jobArea.create({
      data: { jobId: job.id, name: FLOORS[i], floor: String(i + 1), sortOrder: i },
    });
  }
  console.log(`areas: ${FLOORS.join(", ")}`);

  // Personnel (skip any name that already exists)
  for (const p of PERSONNEL) {
    const dup = await prisma.personnel.findFirst({
      where: { firstName: p.firstName, lastName: p.lastName, deletedAt: null },
    });
    if (dup) {
      console.log(`  personnel exists, skipping: ${p.firstName} ${p.lastName}`);
      continue;
    }
    await prisma.personnel.create({
      data: {
        firstName: p.firstName,
        lastName: p.lastName,
        trade: p.trade,
        title: p.title,
        employmentType: "CONTRACTOR_1099",
        notes: p.notes,
        createdByUserId: creator.id,
      },
    });
    console.log(`  personnel: ${p.firstName} ${p.lastName}`);
  }

  await recomputeJobBalance(job.id);
  const fresh = await prisma.job.findUnique({
    where: { id: job.id },
    select: { balanceDue: true },
  });

  const billed = APPLICATIONS.reduce((s, a) => s + a[1], 0);
  const paid = APPLICATIONS.filter((a) => a[3]).reduce((s, a) => s + a[1], 0);
  const costs = EXPENSES.reduce((s, e) => s + e[3], 0);
  console.log("\n=== IMPORT SUMMARY ===");
  console.log(`contract:        $832,500.00 (incl. CO#1 $2,500)`);
  console.log(`billed (1–12):   $${billed.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`collected:       $${paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`outstanding A/R: $${(billed - paid).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`costs to date:   $${costs.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`job balanceDue:  $${Number(fresh?.balanceDue).toLocaleString()}`);
  await prisma.$disconnect();
}

main();
