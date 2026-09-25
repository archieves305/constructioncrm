/**
 * Follow-up to replay-crm-leg-2026-09-24.ts: BullMQ keeps `crm-<txnId>` job
 * ids for 7/30 days, so re-adding a credit whose earlier attempt failed
 * with "CRM 400: Too small" was a no-op. Remove the stale job, then enqueue
 * again. Only credits (amount < 0) that still have no CRM expense.
 */
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "./_env";
loadEnvFile();
import { CRM_POST_QUEUE, enqueueCrmPost } from "@/server/queues";

const db = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const queue = new Queue(CRM_POST_QUEUE, { connection });

async function main() {
  const credits = await db.transaction.findMany({
    where: { crmJobId: { not: null }, crmExpenseId: null, amount: { lt: 0 } },
    select: { id: true, amount: true, lastCrmError: true },
  });
  console.log("credits still unposted:", credits.length);
  let removed = 0, added = 0;
  for (const c of credits) {
    const job = await queue.getJob(`crm-${c.id}`);
    if (job) {
      const state = await job.getState();
      console.log("  stale job", c.id, String(c.amount), "state:", state);
      await job.remove();
      removed++;
    }
    await enqueueCrmPost(c.id);
    added++;
  }
  console.log(`removed ${removed} stale jobs, enqueued ${added}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await queue.close(); await connection.quit(); await db.$disconnect(); });
