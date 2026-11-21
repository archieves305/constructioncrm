/**
 * One-off: take people off the workflow steps the old rules handed them.
 *
 * Richard, 2026-11-21: workflow steps are a checklist on the job, never
 * someone's task. New steps are created with nobody on them; this clears the
 * steps created before that. Only steps nobody has started are touched —
 * PENDING (Ready or still waiting). In-progress and blocked steps keep their
 * owner, correction tasks from a failed inspection keep theirs, manual tasks
 * added to a phase are not steps and are left alone. Nothing is deleted and
 * nobody is notified; each step's timeline records the change.
 *
 *   npx tsx scripts/unassign-workflow-steps-2026-11.ts          # dry run; writes nothing
 *   npx tsx scripts/unassign-workflow-steps-2026-11.ts --yes    # applies
 *
 * Prod: run as `knuco` with /etc/knuco/env loaded, from /opt/knuco.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { recordAudit } from "../src/lib/audit/record";
import { updateTask } from "../src/lib/tasks/update";
import { STEP_CORRECTION_MARK } from "../src/lib/workflows/state";

const ACTOR_EMAIL = "richard@rcareylaw.com";
const apply = process.argv.includes("--yes");

async function main() {
  const actor = await prisma.user.findUnique({ where: { email: ACTOR_EMAIL }, select: { id: true } });
  if (!actor) throw new Error(`No user ${ACTOR_EMAIL}`);

  const rows = await prisma.task.findMany({
    where: {
      workflowTaskKey: { not: null },
      NOT: { workflowTaskKey: { contains: STEP_CORRECTION_MARK } },
      status: "PENDING",
      assignedUserId: { not: null },
    },
    select: {
      id: true,
      title: true,
      activatedAt: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      job: { select: { jobNumber: true } },
      violationCase: { select: { caseNumber: true } },
    },
    orderBy: [{ jobId: "asc" }, { workflowSortOrder: "asc" }],
  });

  const byPerson = new Map<string, { ready: number; waiting: number }>();
  const bySubject = new Map<string, number>();
  for (const r of rows) {
    const who = r.assignedTo ? `${r.assignedTo.firstName} ${r.assignedTo.lastName}`.trim() : "?";
    const p = byPerson.get(who) ?? { ready: 0, waiting: 0 };
    if (r.activatedAt) p.ready++;
    else p.waiting++;
    byPerson.set(who, p);
    const subj = r.job?.jobNumber ?? r.violationCase?.caseNumber ?? "(no subject)";
    bySubject.set(subj, (bySubject.get(subj) ?? 0) + 1);
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${rows.length} untouched workflow steps have someone on them`);
  console.log("\nBy person (ready now · still waiting):");
  for (const [who, n] of [...byPerson.entries()].sort((a, b) => b[1].ready + b[1].waiting - (a[1].ready + a[1].waiting))) {
    console.log(`  ${who.padEnd(28)} ${String(n.ready).padStart(4)} · ${String(n.waiting).padStart(4)}`);
  }
  console.log("\nBy job / case:");
  for (const [subj, n] of [...bySubject.entries()].sort()) console.log(`  ${subj.padEnd(12)} ${n}`);

  const kept = await prisma.task.count({
    where: { workflowTaskKey: { not: null }, NOT: { workflowTaskKey: { contains: STEP_CORRECTION_MARK } }, status: { in: ["IN_PROGRESS", "BLOCKED"] }, assignedUserId: { not: null } },
  });
  console.log(`\nKept (in progress or blocked, owner stays): ${kept}`);

  if (!apply) {
    console.log("\nNothing written. Re-run with --yes to apply.");
    return;
  }

  let done = 0;
  const failed: { id: string; error: string }[] = [];
  for (const r of rows) {
    try {
      await updateTask({ id: r.id, input: { assignedUserId: null }, actorUserId: actor.id, notify: "none" });
      done++;
    } catch (err) {
      failed.push({ id: r.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await recordAudit({
    actorUserId: actor.id,
    entityType: "task",
    entityId: "bulk",
    action: "workflow_steps_unassign",
    after: { unassigned: done, failed, byPerson: Object.fromEntries(byPerson), bySubject: Object.fromEntries(bySubject) },
  });
  console.log(`\nUnassigned ${done}; failed ${failed.length}`);
  for (const f of failed) console.log(`  ${f.id}: ${f.error}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
