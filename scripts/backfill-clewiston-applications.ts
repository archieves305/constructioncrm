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
// Tolerates the job already being PROGRESS with one seeded SOV line for the
// contract (the UI does that on switch) — the line is reused.
//
// Invoices the import didn't write have no "period to" note. VOID ones are
// left alone. Any other one aborts with a dump, unless its period is given:
//   npx tsx scripts/backfill-clewiston-applications.ts --period-13=2026-04-30
// which treats INV-00009-13 as application 13 for that period (gross = ÷0.9).

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
        select: { id: true, invoiceNumber: true, amount: true, notes: true, status: true, issueDate: true, dueDate: true, applicationNumber: true, _count: { select: { lines: true, payments: true } } },
      },
    },
  });
  if (!job) {
    console.error("ABORT: Towne Place Suites job not found");
    process.exit(1);
  }
  console.log(`job: ${job.jobNumber} — ${job.title} (${job.billingMethod}, contract $${Number(job.contractAmount).toLocaleString()})`);
  console.log("invoices on file:");
  for (const inv of job.invoices) {
    console.log(
      `  ${inv.invoiceNumber.padEnd(14)} ${inv.status.padEnd(5)} $${Number(inv.amount).toLocaleString().padStart(11)}  issued ${inv.issueDate.toISOString().slice(0, 10)}  due ${inv.dueDate?.toISOString().slice(0, 10) ?? "—"}  app#${inv.applicationNumber ?? "—"} lines=${inv._count.lines} pay=${inv._count.payments}  notes=${inv.notes ? JSON.stringify(inv.notes.slice(0, 90)) : "null"}`,
    );
  }

  if (job.invoices.some((i) => i._count.lines > 0)) {
    console.error("ABORT: some invoices already carry application lines — backfill already ran?");
    process.exit(1);
  }

  // --period-N=YYYY-MM-DD for invoices the import didn't annotate.
  const periodOverrides = new Map<number, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--period-(\d+)=(\d{4}-\d{2}-\d{2})$/);
    if (m) periodOverrides.set(Number(m[1]), m[2]);
  }

  // Parse app number + period from what the import wrote.
  const apps: { id: string; invoiceNumber: string; num: number; periodTo: string; net: number; gross: number }[] = [];
  const unparsed: string[] = [];
  for (const inv of job.invoices) {
    const num = Number(inv.invoiceNumber.replace(/^INV-\d+-/, ""));
    const m = inv.notes?.match(/period to (\d{4}-\d{2}-\d{2})/);
    const periodTo = m?.[1] ?? (Number.isFinite(num) ? periodOverrides.get(num) : undefined);
    if (!Number.isFinite(num) || !periodTo) {
      if (inv.status === "VOID") {
        console.log(`  skipping ${inv.invoiceNumber}: VOID, not part of the application sequence`);
        continue;
      }
      unparsed.push(inv.invoiceNumber);
      continue;
    }
    const net = Number(inv.amount);
    apps.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, num, periodTo, net, gross: round2(net / (1 - RETAINAGE / 100)) });
  }
  if (unparsed.length) {
    console.error(`ABORT: no period known for ${unparsed.join(", ")} — see the dump above. If it is a payment application, rerun with --period-N=YYYY-MM-DD; if it is stray, VOID it in the CRM first.`);
    process.exit(1);
  }
  apps.sort((a, b) => a.num - b.num);
  for (let i = 1; i < apps.length; i++) {
    if (apps[i].num !== apps[i - 1].num + 1) {
      console.error(`ABORT: application numbers are not consecutive (${apps[i - 1].num} → ${apps[i].num})`);
      process.exit(1);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: { billingMethod: "PROGRESS", retainagePercent: RETAINAGE },
    });
    // Reuse the single contract-wide line the UI seeds on switching to
    // PROGRESS; anything else on the schedule is unexpected.
    const existingSov = await tx.sovLine.findMany({ where: { jobId: job.id } });
    if (existingSov.length > 1 || (existingSov.length === 1 && Number(existingSov[0].scheduledValue) !== Number(job.contractAmount))) {
      throw new Error(`unexpected schedule of values: ${existingSov.map((l) => `#${l.itemNo} ${l.description} $${Number(l.scheduledValue)}`).join("; ")}`);
    }
    const sov =
      existingSov[0] ??
      (await tx.sovLine.create({
        data: {
          jobId: job.id,
          itemNo: 1,
          description: "Drywall, framing & ceilings — base contract incl. CO#1 (added framing materials)",
          scheduledValue: job.contractAmount,
          sortOrder: 0,
        },
      }));
    console.log(`sov line: #${sov.itemNo} ${sov.description} ($${Number(sov.scheduledValue).toLocaleString()})${existingSov[0] ? " [existing]" : ""}`);
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
