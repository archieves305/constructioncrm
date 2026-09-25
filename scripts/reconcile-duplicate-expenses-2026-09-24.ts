/**
 * One-off: apply Richard's 2026-09-24 rulings on the manual↔cc-allocator
 * twins found by the reconciliation pressure test.
 *
 *   - Every SAME-DAY pair is a duplicate → delete the typed-in row
 *     (audited, contract reversed), EXCEPT JOB-00006 $432.00 where the
 *     payees differ (Roberto Rodriguez vs Richard Perez) → keep both.
 *   - The one ±3-day pair (JOB-00006 $800.00, Octavio Obregon vs Sikaffy &
 *     Bogran) → keep both.
 *
 * Goes through the same `resolvePair` the admin page uses, so the trail is
 * identical: an ExpenseReconciliation row per pair and an AuditEvent per
 * deletion, attributed to Richard.
 *
 *   npx tsx scripts/reconcile-duplicate-expenses-2026-09-24.ts          # dry run
 *   npx tsx scripts/reconcile-duplicate-expenses-2026-09-24.ts --yes    # apply
 *
 * Refuses to apply unless the dry run finds exactly the expected shape
 * (19 duplicates totalling $16,070.96 and 2 keeps; the findings doc said
 * "18" but listed 10+4+3+2 — the dollars were right) — pass --force to
 * override after reading the table.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { pairCandidates, pairKey } from "../src/lib/expenses/reconcile";
import { resolvePair } from "../src/lib/expenses/resolve-pair";

const ACTOR_EMAIL = "richard@rcareylaw.com";
const EXPECTED = { duplicates: 19, keeps: 2, duplicateTotal: 16070.96 };
const KEEP_RULES: { jobNumber: string; amount: number; why: string }[] = [
  { jobNumber: "JOB-00006", amount: 432, why: "different payees: Roberto Rodriguez (typed) vs Richard Perez (bank)" },
  { jobNumber: "JOB-00006", amount: 800, why: "different payees: Octavio Obregon (typed) vs Sikaffy & Bogran (bank), 3 days apart" },
];

async function main() {
  const apply = process.argv.includes("--yes");
  const force = process.argv.includes("--force");
  const actor = await prisma.user.findUnique({ where: { email: ACTOR_EMAIL }, select: { id: true } });
  if (!actor) throw new Error(`actor ${ACTOR_EMAIL} not found`);

  const [rows, decisions] = await Promise.all([
    prisma.jobExpense.findMany({
      where: { status: "APPROVED" },
      select: { id: true, jobId: true, amount: true, incurredDate: true, vendor: true, externalId: true, payrollPaymentId: true, status: true, createdAt: true, createdByUserId: true, job: { select: { jobNumber: true } } },
    }),
    prisma.expenseReconciliation.findMany({ select: { manualExpenseId: true, externalExpenseId: true } }),
  ]);
  const jobNo = new Map(rows.map((r) => [r.id, r.job.jobNumber]));
  const decided = new Set(decisions.map((d) => pairKey(d.manualExpenseId, d.externalExpenseId)));
  const pairs = pairCandidates(rows.map((r) => ({ ...r, amount: Number(r.amount) })), decided);

  const plan = pairs.map((p) => {
    const job = jobNo.get(p.manual.id)!;
    const keep = KEEP_RULES.find((k) => k.jobNumber === job && Math.abs(k.amount - p.manual.amount) < 0.005);
    const decision: "KEEP" | "DUPLICATE" | "SKIP" = keep ? "KEEP" : p.exact ? "DUPLICATE" : "SKIP";
    return { p, job, decision, why: keep?.why ?? (p.exact ? "same day, same amount" : "not same day — left for the page") };
  });

  console.log("\nplan:");
  for (const r of plan) {
    console.log(
      `  ${r.decision.padEnd(9)} ${r.job} $${r.p.manual.amount.toFixed(2).padStart(9)}  typed: ${(r.p.manual.vendor ?? "—").padEnd(22)} ${r.p.manual.incurredDate.toISOString().slice(0, 10)}  allocator(${r.p.source}): ${(r.p.external.vendor ?? "—").padEnd(30)} ${r.p.external.incurredDate.toISOString().slice(0, 10)}  — ${r.why}`,
    );
  }
  const dups = plan.filter((r) => r.decision === "DUPLICATE");
  const keeps = plan.filter((r) => r.decision === "KEEP");
  const total = Math.round(dups.reduce((s, r) => s + r.p.manual.amount, 0) * 100) / 100;
  console.log(`\n${dups.length} duplicates ($${total.toFixed(2)}), ${keeps.length} keeps, ${plan.length - dups.length - keeps.length} skipped`);

  const matches = dups.length === EXPECTED.duplicates && keeps.length === EXPECTED.keeps && Math.abs(total - EXPECTED.duplicateTotal) < 0.005;
  if (!matches) console.log(`shape differs from expected (${EXPECTED.duplicates} dups / $${EXPECTED.duplicateTotal} / ${EXPECTED.keeps} keeps)`);
  if (!apply) {
    console.log("dry run — pass --yes to apply");
    return;
  }
  if (!matches && !force) throw new Error("refusing to apply: shape differs; re-check the table and pass --force if it is right");

  let applied = 0;
  for (const r of plan) {
    if (r.decision === "SKIP") continue;
    const res = await resolvePair(
      { manualExpenseId: r.p.manual.id, externalExpenseId: r.p.external.id, decision: r.decision, note: `2026-09-24 reconciliation: ${r.why}` },
      { userId: actor.id },
    );
    if (!res.ok) throw new Error(`${r.job} $${r.p.manual.amount}: ${res.error}`);
    applied++;
    console.log(`  ✓ ${r.decision} ${r.job} $${r.p.manual.amount.toFixed(2)}${res.reversed ? ` (contract −$${res.reversed.toFixed(2)})` : ""}`);
  }
  console.log(`applied ${applied} decisions`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
