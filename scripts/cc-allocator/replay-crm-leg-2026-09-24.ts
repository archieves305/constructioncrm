/**
 * One-off, 2026-09-24, approved by Richard:
 *   1. BNW Construction $11,694.15 (BankTxn cmrf8hvy20hhz12e49t7nvzx0,
 *      JOB-00010) should be job-costed: turn the CRM leg on and enqueue it.
 *   2. The CRM now accepts credits: re-enqueue every card Transaction that
 *      picked a CRM job, has no CRM expense, and is negative (23 rows —
 *      21 rejected with "CRM 400: Too small", 2 never attempted).
 * Idempotent: the CRM dedupes on externalId, the queues on jobId.
 *   npx tsx scripts/replay-crm-leg-2026-09-24.ts          # dry run
 *   npx tsx scripts/replay-crm-leg-2026-09-24.ts --yes    # apply
 */
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "./_env";
loadEnvFile();
import { enqueueBankingPostCrm, enqueueCrmPost } from "@/server/queues";

const BNW_ID = "cmrf8hvy20hhz12e49t7nvzx0";
const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--yes");
  const bnw = await db.bankTxn.findUnique({ where: { id: BNW_ID }, select: { id: true, status: true, target: true, postCrm: true, crmJobId: true, crmExpenseType: true, crmExpenseId: true, amount: true, qboTxnId: true } });
  if (!bnw) throw new Error("BNW row not found");
  console.log("BNW:", { status: bnw.status, target: bnw.target, postCrm: bnw.postCrm, crmJobId: bnw.crmJobId, type: bnw.crmExpenseType, crmExpenseId: bnw.crmExpenseId, amount: String(bnw.amount), qbo: Boolean(bnw.qboTxnId) });
  if (Number(bnw.amount) !== 11694.15 || bnw.crmExpenseId || !bnw.crmJobId || !bnw.crmExpenseType) throw new Error("BNW row is not in the expected state");

  const credits = await db.transaction.findMany({
    where: { crmJobId: { not: null }, crmExpenseId: null, amount: { lt: 0 } },
    select: { id: true, status: true, amount: true, merchantNormalized: true, txnDate: true, lastCrmError: true, crmJobName: true },
    orderBy: { txnDate: "asc" },
  });
  console.log(`credits to replay: ${credits.length}, $${credits.reduce((s, c) => s + Number(c.amount), 0).toFixed(2)}`);
  for (const c of credits) console.log("  ", c.id, c.status, String(c.amount).padStart(9), c.txnDate.toISOString().slice(0, 10), (c.crmJobName ?? "").padEnd(10), c.merchantNormalized.slice(0, 26), (c.lastCrmError ?? "").slice(0, 40));
  if (credits.length !== 23) throw new Error(`expected 23 credits, found ${credits.length}`);
  if (!apply) { console.log("dry run — pass --yes to apply"); return; }

  if (!bnw.postCrm || bnw.status !== "PARTIALLY_POSTED") {
    await db.bankTxn.update({ where: { id: BNW_ID }, data: { postCrm: true, status: "PARTIALLY_POSTED", lastCrmError: null } });
    console.log("BNW: postCrm on, status PARTIALLY_POSTED");
  }
  await enqueueBankingPostCrm(BNW_ID);
  console.log("BNW: enqueued banking-post-crm");
  let n = 0;
  for (const c of credits) { await enqueueCrmPost(c.id); n++; }
  console.log(`enqueued crm-post for ${n} credits`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); setTimeout(() => process.exit(), 1500); });
