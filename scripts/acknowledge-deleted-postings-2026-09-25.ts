/**
 * One-off: record Richard's 2026-09-24 ruling that the three cc-allocator
 * postings missing from the CRM were deleted on purpose, so the Cost
 * Reconciliation page stops listing them. Goes through the same
 * `acknowledgeMissingPosting` the page's button uses (checks each is still
 * missing, snapshots it, writes an AuditEvent, attributed to Richard).
 *
 *   npx tsx scripts/acknowledge-deleted-postings-2026-09-25.ts          # dry run
 *   npx tsx scripts/acknowledge-deleted-postings-2026-09-25.ts --yes    # apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { acknowledgeMissingPosting } from "../src/lib/expenses/acknowledge-posting";
import { fetchAllocatorPostings } from "../src/lib/integrations/cc-allocator/postings";

const ACTOR_EMAIL = "richard@rcareylaw.com";
const NOTE = "Deleted intentionally — confirmed by Richard 2026-09-24 (reconciliation findings, decision 2).";
const EXPECTED = [
  { externalId: "bank:cmrf8hvy30hia12e4b0t3d8v5", amount: 14029.76 }, // BNW Construction, JOB-00011
  { externalId: "bank:cmrzd0kxs008i103qfeutlu8w", amount: 10524.74 }, // BNW Construction, JOB-00010
  { externalId: "bank:cmrf8hvxx0hfx12e48o0p28bz", amount: 1029.6 }, // Roberto Rodriguez, JOB-00006
];

async function main() {
  const apply = process.argv.includes("--yes");
  const actor = await prisma.user.findUnique({ where: { email: ACTOR_EMAIL }, select: { id: true } });
  if (!actor) throw new Error(`actor ${ACTOR_EMAIL} not found`);
  const a = await fetchAllocatorPostings();
  if (!a.configured || !a.ok) throw new Error(`allocator export: ${JSON.stringify(a)}`);
  for (const e of EXPECTED) {
    const p = a.data.postings.find((x) => x.externalId === e.externalId);
    const here = await prisma.jobExpense.findUnique({ where: { externalId: e.externalId }, select: { id: true } });
    console.log(`  ${e.externalId}  allocator: ${p ? `${p.payee} $${p.amount} ${p.date} crmExpenseId=${p.crmExpenseId}` : "NOT FOUND"}  crm: ${here ? "PRESENT" : "missing"}`);
    if (!p || p.amount !== e.amount || here) throw new Error("state differs from the findings; stop");
  }
  if (!apply) { console.log("dry run — pass --yes to apply"); return; }
  for (const e of EXPECTED) {
    const r = await acknowledgeMissingPosting({ externalId: e.externalId, note: NOTE }, { userId: actor.id });
    console.log(r.ok ? `  ✓ acknowledged ${e.externalId}` : `  ✗ ${e.externalId}: ${r.error}`);
    if (!r.ok && r.status !== 409) throw new Error(r.error);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
