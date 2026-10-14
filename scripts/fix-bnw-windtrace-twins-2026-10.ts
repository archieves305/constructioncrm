/**
 * One-off (2026-10-14): 2188 Windtrace (JOB-00010) counted three BNW
 * Construction payments twice — once as payments on BNW's labor contract,
 * once as cc-allocator bank postings. Richard: "make this fix".
 *
 *   1. Each bank posting is marked the same money as its labor payment
 *      (`coverWithLaborPayment`: REJECTED, linked, audited).
 *   2. The 8/17 ACH was $13,199.15; $11,694.15 was 2188's invoice 1314 and,
 *      per the payment's own note, "$1505 was for 2192 Wind Trace Dr". That
 *      $1,505 is recorded as a payment on BNW's labor contract on JOB-00011.
 *   3. The 6/2 BNW bank posting of $25,760.74 was filed on 2192 (JOB-00011).
 *      Richard: "Jun 2 payment is for the initial deposit for 2188." 2188's
 *      deposit is already in the 5/22 labor payment ("Deposit $25,987 and
 *      Draw $15,202.40"), so the posting moves to JOB-00010 and is counted
 *      through that payment.
 *
 * Goes through the same service the Cost Reconciliation buttons use.
 *
 *   npx tsx scripts/fix-bnw-windtrace-twins-2026-10.ts          # dry run
 *   npx tsx scripts/fix-bnw-windtrace-twins-2026-10.ts --yes    # apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { recordAudit } from "../src/lib/audit/record";
import { coverWithLaborPayment } from "../src/lib/expenses/labor-cover";
import { getJobCostSummary } from "../src/lib/services/job-cost";

const ACTOR_EMAIL = "richard@rcareylaw.com";
const PAIRS = [
  { expenseId: "cmug91yzv0002vkbtoef3n7ke", amount: 11694.15, laborPaymentId: "cmrk4e5ec001qndbtcogbg8xq", paid: 11669.15 }, // 7/2 sale (incl. $25 fee)
  { expenseId: "cmubkes3u0014ojbtycqkv013", amount: 13199.15, laborPaymentId: "cmv8ch3wx002juxbtvk4yto4n", paid: 11694.15 }, // 8/17 ACH
  { expenseId: "cmubj7ksu000jojbt0zwxrtuk", amount: 33913.04, laborPaymentId: "cmv8bgz5s0021uxbtoqek221m", paid: 33913.04 }, // 9/16 wire
];
const MOVE = { expenseId: "cms42ouvx0020djbt2ere76iq", amount: 25760.74, from: "JOB-00011", to: "JOB-00010", laborPaymentId: "cmrk4cdsx001ondbtacpbin42", paid: 41189.4 }; // 6/2 deposit for 2188
const SPLIT = { jobNumber: "JOB-00011", crew: "BNW Construction", amount: 1505, date: "2026-08-17" };
const SPLIT_NOTE = "Part of the 8/17 ACH of $13,199.15 (bank row on 2188 Windtrace, JOB-00010); $11,694.15 of it was 2188's invoice 1314. Recorded 2026-10-14.";

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function show(label: string, jobNumber: string) {
  const job = await prisma.job.findUnique({ where: { jobNumber }, select: { id: true } });
  const s = job ? await getJobCostSummary(job.id) : null;
  if (!s) return console.log(`  ${jobNumber} ${label}: no summary`);
  console.log(`  ${jobNumber} ${label}: spent ${usd(s.spent)} · labor not yet paid ${usd(s.laborCommittedOpen)} · committed ${usd(s.committed)} · contract ${usd(s.revisedContract)} · projected profit ${usd(s.projectedProfit)}`);
}

async function main() {
  const apply = process.argv.includes("--yes");
  const actor = await prisma.user.findUnique({ where: { email: ACTOR_EMAIL }, select: { id: true } });
  if (!actor) throw new Error(`actor ${ACTOR_EMAIL} not found`);

  for (const p of PAIRS) {
    const e = await prisma.jobExpense.findUnique({ where: { id: p.expenseId }, select: { amount: true, status: true, coveredByLaborPaymentId: true, vendor: true, job: { select: { jobNumber: true } } } });
    const lp = await prisma.laborPayment.findUnique({ where: { id: p.laborPaymentId }, select: { amount: true, laborContract: { select: { job: { select: { jobNumber: true } } } } } });
    console.log(`  ${e?.job.jobNumber} ${usd(Number(e?.amount))} ${e?.status}${e?.coveredByLaborPaymentId ? " (already covered)" : ""} — ${e?.vendor?.slice(0, 50)}  ⇄  labor payment ${usd(Number(lp?.amount))}`);
    if (!e || !lp || Number(e.amount) !== p.amount || Number(lp.amount) !== p.paid || e.job.jobNumber !== "JOB-00010" || lp.laborContract.job.jobNumber !== "JOB-00010") throw new Error("state differs from the findings; stop");
  }
  const mv = await prisma.jobExpense.findUnique({ where: { id: MOVE.expenseId }, select: { amount: true, status: true, billable: true, commitmentId: true, coveredByLaborPaymentId: true, job: { select: { jobNumber: true } } } });
  const deposit = await prisma.laborPayment.findUnique({ where: { id: MOVE.laborPaymentId }, select: { amount: true, laborContract: { select: { jobId: true, job: { select: { jobNumber: true } } } } } });
  const target = await prisma.job.findUnique({ where: { jobNumber: MOVE.to }, select: { id: true } });
  console.log(`  ${mv?.job.jobNumber} ${usd(Number(mv?.amount))} ${mv?.status} 6/2 BNW posting${mv?.coveredByLaborPaymentId ? " (already covered)" : ""} → ${MOVE.to}  ⇄  labor payment ${usd(Number(deposit?.amount))} (5/22 deposit + draw)`);
  if (!mv || !deposit || !target || Number(mv.amount) !== MOVE.amount || Number(deposit.amount) !== MOVE.paid || deposit.laborContract.job.jobNumber !== MOVE.to || mv.billable || mv.commitmentId || ![MOVE.from, MOVE.to].includes(mv.job.jobNumber)) throw new Error("6/2 posting differs from the findings; stop");
  const contract = await prisma.laborContract.findFirst({ where: { job: { jobNumber: SPLIT.jobNumber }, crew: { name: SPLIT.crew } }, select: { id: true, job: { select: { leadId: true } } } });
  if (!contract) throw new Error(`${SPLIT.crew} has no labor contract on ${SPLIT.jobNumber}`);
  const splitDone = await prisma.laborPayment.findFirst({ where: { laborContractId: contract.id, amount: SPLIT.amount, paidDate: new Date(`${SPLIT.date}T00:00:00Z`) }, select: { id: true } });
  console.log(`  ${SPLIT.jobNumber}: ${usd(SPLIT.amount)} payment to ${SPLIT.crew} on ${SPLIT.date} — ${splitDone ? "already recorded" : "to record"}`);

  await show("before", "JOB-00010");
  await show("before", "JOB-00011");
  if (!apply) return console.log("dry run — pass --yes to apply");

  for (const p of PAIRS) {
    const r = await coverWithLaborPayment(p.expenseId, p.laborPaymentId, actor.id);
    console.log(r.ok ? `  ✓ ${p.expenseId} counted through ${p.laborPaymentId}` : `  – ${p.expenseId}: ${r.error}`);
    if (!r.ok && r.status !== 409) throw new Error(r.error);
  }
  if (mv.job.jobNumber === MOVE.from) {
    // Not billable and not on a commitment (checked above), so no contract or rollup figure moves with it.
    await prisma.jobExpense.update({ where: { id: MOVE.expenseId }, data: { jobId: target.id } });
    await recordAudit({ actorUserId: actor.id, entityType: "JobExpense", entityId: MOVE.expenseId, action: "expense_move_job", before: { job: MOVE.from }, after: { job: MOVE.to, reason: "Richard 2026-10-14: the 6/2 BNW payment was the initial deposit for 2188" } });
    console.log(`  ✓ moved ${MOVE.expenseId} ${MOVE.from} → ${MOVE.to}`);
  }
  const d = await coverWithLaborPayment(MOVE.expenseId, MOVE.laborPaymentId, actor.id);
  console.log(d.ok ? `  ✓ ${MOVE.expenseId} counted through the 5/22 deposit payment` : `  – ${MOVE.expenseId}: ${d.error}`);
  if (!d.ok && d.status !== 409) throw new Error(d.error);
  if (!splitDone) {
    const pay = await prisma.laborPayment.create({
      data: { laborContractId: contract.id, amount: SPLIT.amount, paidDate: new Date(`${SPLIT.date}T00:00:00Z`), method: "ACH", reference: "Knu Payment", notes: SPLIT_NOTE, createdByUserId: actor.id },
    });
    await prisma.activityLog.create({ data: { leadId: contract.job.leadId, activityType: "NOTE", title: `Labor payment to ${SPLIT.crew}: $${SPLIT.amount.toLocaleString()} (part of the 8/17 ACH filed on 2188)`, createdByUserId: actor.id } });
    await recordAudit({ actorUserId: actor.id, entityType: "LaborPayment", entityId: pay.id, action: "create", after: { laborContractId: contract.id, amount: SPLIT.amount, source: "fix-bnw-windtrace-twins-2026-10" } });
    console.log(`  ✓ recorded ${usd(SPLIT.amount)} on ${SPLIT.jobNumber} (${pay.id})`);
  }
  await show("after", "JOB-00010");
  await show("after", "JOB-00011");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
