/**
 * Give an owner to the open workflow steps that have none (2026-10, audit roadmap Stage D).
 *
 * New steps already resolve through `resolveAssignee`, which now falls back to
 * the subject's coordinator (case manager, else the job's project manager)
 * when nobody fills the step's role. This applies the same rule to the steps
 * that were created before it, through `reassignUnresolved` — one instance at
 * a time, each assignment an ordinary `updateTask` (timeline, audit, one batched
 * notice per person for the active steps).
 *
 * Dry run by default (lists who would get what); `--yes` applies. Idempotent —
 * a second run finds nothing it can assign.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { loadRoleContext, reassignUnresolved, resolveAssignee } from "../src/lib/workflows/roles";

async function main() {
  const apply = process.argv.includes("--yes");
  const actor = await prisma.user.findFirst({ where: { role: { name: "ADMIN" }, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
  if (!actor) throw new Error("No active admin to record the assignments under");

  const open = await prisma.task.findMany({
    where: { assignedUserId: null, workflowRole: { not: null }, workflowInstanceId: { not: null }, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } },
    select: { id: true, title: true, workflowRole: true, activatedAt: true, workflowInstanceId: true, job: { select: { jobNumber: true } } },
  });
  const byInstance = new Map<string, typeof open>();
  for (const t of open) byInstance.set(t.workflowInstanceId!, [...(byInstance.get(t.workflowInstanceId!) ?? []), t]);

  const people = new Map((await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  console.log(`${apply ? "APPLYING" : "DRY RUN — nothing will be written"} · ${open.length} open steps with no owner on ${byInstance.size} workflows (${open.filter((t) => t.activatedAt).length} active)\n`);

  let assignable = 0;
  let assigned = 0;
  for (const [instanceId, tasks] of byInstance) {
    const ctx = await loadRoleContext(prisma, { instanceId });
    const plan = tasks.map((t) => ({ t, to: resolveAssignee(t.workflowRole!, ctx) }));
    const can = plan.filter((p) => p.to);
    assignable += can.length;
    const label = tasks[0].job?.jobNumber ?? instanceId;
    console.log(`${label}: ${can.length} of ${tasks.length} can be assigned`);
    for (const p of plan) console.log(`  ${p.t.activatedAt ? "active " : "waiting"}  ${p.t.workflowRole?.padEnd(18)} ${p.t.title.slice(0, 60).padEnd(60)} → ${p.to ? people.get(p.to) ?? p.to : "nobody (no PM / case manager)"}`);
    if (apply && can.length) assigned += await reassignUnresolved(instanceId, actor.id);
  }
  console.log(apply ? `\nAssigned ${assigned}.` : `\nDry run — ${assignable} would be assigned. Re-run with --yes to apply.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
