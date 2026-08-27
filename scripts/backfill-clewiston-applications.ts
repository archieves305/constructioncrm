import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { getBillingSummary } from "../src/lib/services/progress-billing";

// One-off backfill: convert JOB-00009's twelve imported invoices (AIA payment
// applications 1–12, stored net of 10% retainage by import-clewiston-tps.ts)
// into proper progress-billing applications.
//
//   - job → billingMethod PROGRESS, retainagePercent 10
//   - one schedule-of-values line for the whole $832,500 contract (CO#1's
//     $2,500 was already folded into the contract sum at import)
//   - each invoice gets applicationNumber (from its INV suffix), the period
//     (from its notes), the 10% snapshot, and one line whose gross work is
//     amount ÷ 0.9
//
// Aborts unless every recomputed "current payment due" equals the stored
// amount to the cent, and is idempotent (skips if lines already exist).
// Run on the droplet: see docs — `npx tsx scripts/backfill-clewiston-applications.ts`

const RETAINAGE = 10;
const CONTRACT_START = new Date("2025-03-07T00:00:00Z");

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const job = await prisma.job.findFirst({
    where: { title: { contains: "Towne Place Suites" } },
    select: {
      id: true,
      jobNumber: true,
      title: true,
      serviceType: true,
      contractAmount: true,
      billingMethod: true,
      invoices: {
        orderBy: { createdAt: "asc" },
        select: { id: true, invoiceNumber: true, amount: true, notes: true, status: true, applicationNumber: true, _count: { select: { lines: true } } },
      },
    },
  });
  if (!job) {
    console.error("ABORT: Towne Place Suites job not found");
    process.exit(1);
  }
  console.log(`job: ${job.jobNumber} — ${job.title} (${job.billingMethod}, contract $${Number(job.contractAmount).toLocaleString()})`);

  if (job.invoices.some((i) => i._count.lines > 0)) {
    console.error("ABORT: some invoices already carry application lines — backfill already ran?");
    process.exit(1);
  }

  // Parse app number + period from what the import wrote.
  const apps = job.invoices.map((inv) => {
    const num = Number(inv.invoiceNumber.replace(/^INV-\d+-/, ""));
    const m = inv.notes?.match(/period to (\d{4}-\d{2}-\d{2})/);
    if (!Number.isFinite(num) || !m) {
      console.error(`ABORT: can't parse application number/period from ${inv.invoiceNumber}: ${inv.notes}`);
      process.exit(1);
    }
    const net = Number(inv.amount);
    return { id: inv.id, invoiceNumber: inv.invoiceNumber, num, periodTo: m[1], net, gross: round2(net / (1 - RETAINAGE / 100)) };
  });
  apps.sort((a, b) => a.num - b.num);

  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: { billingMethod: "PROGRESS", retainagePercent: RETAINAGE },
    });
    const sov = await tx.sovLine.create({
      data: {
        jobId: job.id,
        itemNo: 1,
        description: "Drywall, framing & ceilings — base contract incl. CO#1 (added framing materials)",
        scheduledValue: job.contractAmount,
        sortOrder: 0,
      },
    });
    let prevTo: string | null = null;
    for (const a of apps) {
      const periodFrom = prevTo
        ? new Date(new Date(`${prevTo}T00:00:00Z`).getTime() + 86400000)
        : CONTRACT_START;
      await tx.invoice.update({
        where: { id: a.id },
        data: {
          applicationNumber: a.num,
          periodFrom,
          periodTo: new Date(`${a.periodTo}T00:00:00Z`),
          retainagePercent: RETAINAGE,
          lines: { create: { sovLineId: sov.id, workCompleted: a.gross } },
        },
      });
      prevTo = a.periodTo;
      console.log(`  app ${String(a.num).padStart(2)}: period to ${a.periodTo}  gross $${a.gross.toLocaleString()}  net $${a.net.toLocaleString()}`);
    }

    // Verify the replayed G702 maths reproduces every stored amount.
    const summary = await getBillingSummary(job.id, tx as typeof prisma);
    if (!summary) throw new Error("summary unavailable");
    let bad = 0;
    for (const app of summary.applications) {
      const stored = apps.find((a) => a.num === app.applicationNumber)!.net;
      if (Math.abs(app.computed.currentDue - stored) > 0.005) {
        console.error(`  MISMATCH app ${app.applicationNumber}: computed $${app.computed.currentDue} vs stored $${stored}`);
        bad++;
      }
    }
    if (bad) throw new Error(`${bad} application(s) do not reproduce — rolled back`);

    console.log("\n=== BACKFILL SUMMARY ===");
    console.log(`completed to date:  $${summary.totals.completedToDate.toLocaleString()}`);
    console.log(`retainage held:     $${summary.totals.retainageHeld.toLocaleString()}`);
    console.log(`billed to date:     $${summary.totals.billedToDate.toLocaleString()}`);
    console.log(`open receivable:    $${summary.totals.openReceivable.toLocaleString()}`);
    console.log(`balance to finish:  $${summary.totals.balanceToFinish.toLocaleString()}`);
    console.log(`next application:   #${summary.nextApplicationNumber} from ${summary.nextPeriodFrom}`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
