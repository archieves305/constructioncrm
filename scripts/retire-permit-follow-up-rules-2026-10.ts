/**
 * Switch off the follow-up rules that hung on permit and inspection events
 * and cancel what they had queued (2026-10-03).
 *
 * Richard's ruling: permit follow-ups for staff are ordinary tasks raised by
 * the permit crons (lib/permits/alert-run.ts), and customers get no automatic
 * mail on a permit event. The app no longer emits these events; this makes
 * the rules say so and clears their queue, so nothing is left to send if the
 * rule processor is ever scheduled.
 *
 * Dry run by default; `--yes` applies. Idempotent.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import {
  INSPECTION_EVENTS,
  PERMIT_EVENTS,
} from "../src/lib/follow-ups/permit-events";

async function main() {
  const apply = process.argv.includes("--yes");
  const triggers = [...PERMIT_EVENTS, ...INSPECTION_EVENTS] as string[];
  const rules = await prisma.followUpRule.findMany({
    where: { triggerEvent: { in: triggers } },
    select: { id: true, name: true, triggerEvent: true, isActive: true },
    orderBy: { triggerEvent: "asc" },
  });
  const active = rules.filter((r) => r.isActive);
  const pending = await prisma.followUpExecution.findMany({
    where: { ruleId: { in: rules.map((r) => r.id) }, status: "PENDING" },
    select: { id: true },
  });

  console.log(
    `${rules.length} permit / inspection rules, ${active.length} active; ${pending.length} pending executions`,
  );
  for (const r of active)
    console.log(`  switch off: ${r.triggerEvent} — ${r.name}`);

  if (!apply) {
    console.log("Dry run — nothing written. Re-run with --yes to apply.");
    return;
  }
  const off = await prisma.followUpRule.updateMany({
    where: { id: { in: active.map((r) => r.id) } },
    data: { isActive: false },
  });
  const cancelled = await prisma.followUpExecution.updateMany({
    where: { id: { in: pending.map((e) => e.id) } },
    data: { status: "CANCELLED" },
  });
  if (off.count + cancelled.count > 0)
    await prisma.auditEvent.create({
      data: {
        entityType: "FollowUpRule",
        entityId: "permit-and-inspection-rules",
        action: "retire_permit_rules",
        afterJson: {
          rulesSwitchedOff: active.map((r) => r.name),
          executionsCancelled: cancelled.count,
        },
      },
    });
  console.log(
    `Switched off ${off.count} rules, cancelled ${cancelled.count} executions.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
