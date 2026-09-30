/**
 * One-off: move the open jobs and violation cases from the long-form
 * workflow templates onto the streamlined generation (seeded 2026-09-30).
 *
 * Nothing is deleted. Completed steps and steps a person skipped are left
 * exactly as they are; the open steps of the earlier generation are retired
 * with one recognisable reason; a streamlined step is born done when every
 * earlier step it replaces was done. No notifications are sent. The permit
 * status and decision are never written.
 *
 * The migration cannot be undone in place — the undo is the database
 * backup — so: inventory, dry run, read the report, one job, then the rest.
 *
 *   npx tsx scripts/migrate-workflows-slim-2026-10.ts --inventory        # what is there; writes nothing
 *   npx tsx scripts/migrate-workflows-slim-2026-10.ts                    # dry run; writes nothing
 *   npx tsx scripts/migrate-workflows-slim-2026-10.ts --only JOB-00017 --yes
 *   npx tsx scripts/migrate-workflows-slim-2026-10.ts --yes
 *
 * Options: --only <job number | case number> · --include-closed (closed
 * jobs and cases stay on their workflow by default) · --grace-days <n>
 * (earliest due date for a newly Ready step, business days; default 5) ·
 * --force (run again over an instance already migrated).
 *
 * Prod: run as `knuco` with /etc/knuco/env loaded, from /opt/knuco.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { migrateInstance, type MigrationPlan, type MigrationResult, type SlimMapping } from "../src/lib/workflows/migrate";
import { contentHash } from "../src/lib/workflows/seed";
import { WORKFLOW_ROLES, WORKFLOW_ROLE_LABEL } from "../src/lib/workflows/role-labels";
import { WORKFLOW_SEED_GENERATIONS } from "../prisma/seeds/workflows";
import { SLIM_ABSORBS, SLIM_DROPPED, SLIM_PHASE_MAP, SLIM_TOGGLE_MAP } from "../prisma/seeds/workflows/v2/mapping";

const ACTOR_EMAIL = "richard@rcareylaw.com";
const MAPPING: SlimMapping = { absorbs: SLIM_ABSORBS, dropped: SLIM_DROPPED, toggles: SLIM_TOGGLE_MAP, phases: SLIM_PHASE_MAP };

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const hashes = new Map(WORKFLOW_SEED_GENERATIONS.map((t) => [t.key, t.generations.map((g) => ({ generation: g.generation, hash: contentHash(g.definition) }))]));
const generationOf = (key: string, hash: string) => hashes.get(key)?.find((g) => g.hash === hash)?.generation ?? null;

type InstanceRow = Awaited<ReturnType<typeof loadInstances>>[number];

async function loadInstances() {
  return prisma.jobWorkflowInstance.findMany({
    orderBy: { appliedAt: "asc" },
    select: {
      id: true,
      status: true,
      permitStatus: true,
      scopeToggles: true,
      appliedAt: true,
      job: { select: { jobNumber: true, currentStage: { select: { name: true, isClosed: true } } } },
      violationCase: { select: { caseNumber: true, status: true } },
      modules: { where: { removedAt: null }, orderBy: { addedAt: "asc" }, select: { templateKey: true, templateVersion: { select: { version: true, contentHash: true } } } },
    },
  });
}

const labelOf = (i: InstanceRow) => i.job?.jobNumber ?? i.violationCase?.caseNumber ?? i.id;
const isClosed = (i: InstanceRow) => (i.job ? i.job.currentStage.isClosed : i.violationCase ? ["CLOSED", "CANCELLED"].includes(i.violationCase.status) : false);
const pinsOf = (i: InstanceRow) => i.modules.map((m) => `${m.templateKey}@v${m.templateVersion.version}`).join(" + ");
/** Every module on the newest seeded generation already. */
const onTarget = (i: InstanceRow) => i.modules.every((m) => generationOf(m.templateKey, m.templateVersion.contentHash) === hashes.get(m.templateKey)?.at(-1)?.generation);

/** The published version of every seeded template must be the streamlined one, or there is nothing to migrate to. */
async function checkTargets(): Promise<string[]> {
  const problems: string[] = [];
  for (const t of WORKFLOW_SEED_GENERATIONS) {
    const newest = hashes.get(t.key)!.at(-1)!;
    const published = await prisma.workflowTemplateVersion.findFirst({
      where: { template: { key: t.key, isActive: true }, status: "PUBLISHED" },
      orderBy: { version: "desc" },
      select: { version: true, contentHash: true },
    });
    if (!published) problems.push(`${t.key}: no published version — run prisma/seed-workflows.ts`);
    else if (published.contentHash !== newest.hash) problems.push(`${t.key}: the published v${published.version} is not the streamlined generation (edited since the seed?)`);
  }
  return problems;
}

async function inventory() {
  console.log("== Template versions");
  const versions = await prisma.workflowTemplateVersion.findMany({
    orderBy: [{ template: { key: "asc" } }, { version: "asc" }],
    select: { version: true, status: true, contentHash: true, changeNotes: true, template: { select: { key: true } }, _count: { select: { modules: true, tasks: true } } },
  });
  for (const v of versions) {
    const gen = generationOf(v.template.key, v.contentHash);
    console.log(
      `  ${v.template.key} v${v.version} ${v.status.toLowerCase()} · ${v._count.tasks} steps · pinned by ${v._count.modules} · ${gen ? `seeded generation ${gen}` : v.status === "DRAFT" ? "draft" : "NOT a seeded version"}${v.changeNotes ? ` · "${v.changeNotes}"` : ""}`,
    );
  }

  console.log("\n== Workflows");
  const instances = await loadInstances();
  for (const i of instances) {
    const rows = await prisma.task.groupBy({ by: ["status"], where: { workflowInstanceId: i.id }, _count: { _all: true } });
    const active = await prisma.task.count({ where: { workflowInstanceId: i.id, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, activatedAt: { not: null } } });
    const counts = rows.map((r) => `${r.status.toLowerCase()} ${r._count._all}`).join(", ");
    const where = i.job ? `stage ${i.job.currentStage.name}` : `case ${i.violationCase?.status.toLowerCase()}`;
    console.log(`  ${labelOf(i)} · ${where}${isClosed(i) ? " (closed)" : ""} · ${pinsOf(i)}${onTarget(i) ? " · streamlined" : ""} · permit ${i.permitStatus.toLowerCase()} · ${counts} · ${active} active`);
    const toggles = JSON.stringify(i.scopeToggles ?? {});
    if (toggles !== "{}") console.log(`      scope: ${toggles}`);
    const inFlight = await prisma.task.findMany({
      where: {
        workflowInstanceId: i.id,
        OR: [{ status: "IN_PROGRESS" }, { status: "BLOCKED" }, { workflowTaskKey: { contains: ":correction:" }, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } }, { workflowTaskKey: null }],
      },
      select: { title: true, status: true, workflowTaskKey: true, inspectionResult: true },
    });
    for (const t of inFlight) {
      const kind = !t.workflowTaskKey ? "manual task" : t.workflowTaskKey.includes(":correction:") ? "open correction" : t.inspectionResult === "FAIL" ? "failed inspection" : t.status === "BLOCKED" ? "blocked" : "in progress";
      console.log(`      ${kind}: ${t.title} (${t.status.toLowerCase()})`);
    }
  }

  console.log("\n== Company role defaults (Admin → Workflow Roles)");
  const defaults = await prisma.workflowRoleDefault.findMany({ select: { role: true, user: { select: { firstName: true, lastName: true, isActive: true } } } });
  const byRole = new Map(defaults.map((d) => [d.role, d.user]));
  const used = new Set(WORKFLOW_SEED_GENERATIONS.flatMap((t) => t.generations.at(-1)!.definition.tasks.map((s) => s.role)));
  for (const role of WORKFLOW_ROLES) {
    if (!used.has(role)) continue;
    const u = byRole.get(role);
    const fromSubject = role === "PROJECT_MANAGER" ? " (else the job's PM)" : role === "SALES_REP" ? " (else the job's sales rep)" : role === "CASE_MANAGER" ? " (else the case's manager)" : "";
    console.log(`  ${WORKFLOW_ROLE_LABEL[role]}: ${u ? `${u.firstName} ${u.lastName}${u.isActive ? "" : " — INACTIVE"}` : `nobody${fromSubject}`}`);
  }

  const problems = await checkTargets();
  console.log(`\n== Streamlined templates ${problems.length === 0 ? "are seeded and published" : "are NOT ready"}`);
  for (const p of problems) console.log(`  ${p}`);
}

function describe(plan: MigrationPlan): string[] {
  const lines = [
    `      ${plan.plan.tasks.length} streamlined steps: ${plan.create.length} new, ${plan.plan.tasks.length - plan.create.length} carried by key (${plan.refresh.length} refreshed)`,
    `      born done: ${plan.complete.length} · partly done: ${plan.notes.length} · inherit owner/status/date: ${plan.carry.length}`,
    `      earlier steps retired: ${plan.skip.length} · left as they are: ${plan.kept.completed} completed, ${plan.kept.peopleSkipped} skipped by a person, ${plan.kept.alreadyRetired} already retired, ${plan.kept.manual} manual`,
  ];
  for (const c of plan.complete) lines.push(`        done: ${plan.plan.tasks.find((t) => t.key === c.key)?.title} ← ${c.from.length} earlier step${c.from.length === 1 ? "" : "s"}`);
  for (const n of plan.notes) lines.push(`        partly: ${plan.plan.tasks.find((t) => t.key === n.key)?.title} ← ${n.done.join("; ")}`);
  for (const c of plan.carry) lines.push(`        inherits: ${plan.plan.tasks.find((t) => t.key === c.key)?.title}${c.status ? ` · ${c.status.toLowerCase()}` : ""}${c.assigneeId ? " · owner" : ""}${c.dueAt ? " · hand-set date" : ""}`);
  if (plan.droppedToggles.length > 0) lines.push(`      scope options with no streamlined counterpart: ${plan.droppedToggles.join(", ")}`);
  if (plan.unmapped.length > 0) lines.push(`      steps added in the editor, retired with the rest: ${plan.unmapped.join(", ")}`);
  if (plan.plan.warnings.length > 0) lines.push(`      WARNINGS: ${plan.plan.warnings.join(" | ")}`);
  return lines;
}

function report(r: MigrationResult) {
  console.log(`  ${r.label}: ${r.outcome}${r.detail ? ` — ${r.detail}` : ""}${r.before ? ` · was ${r.before.pins.join(" + ")}` : ""}`);
  if (r.plan && r.outcome !== "blocked") for (const line of describe(r.plan)) console.log(line);
  if (r.after && r.before) {
    console.log(`      now ${r.after.pins.join(" + ")} · created ${r.after.created}, refreshed ${r.after.refreshed}, born done ${r.after.completed}, retired ${r.after.retired}, woke ${r.after.activated}, dates moved out ${r.after.floored}`);
    const total = (rows: Record<string, number>) => Object.values(rows).reduce((a, b) => a + b, 0);
    // Invariants: nothing deleted; nothing a person completed was un-completed.
    const nothingDeleted = total(r.after.rows) === total(r.before.rows) + r.after.created;
    const completedKept = (r.after.rows.COMPLETED ?? 0) === (r.before.rows.COMPLETED ?? 0) + r.after.completed;
    console.log(`      check: nothing deleted ${nothingDeleted ? "✓" : "✗ ROW COUNT CHANGED"} · completed steps kept ${completedKept ? "✓" : "✗ COMPLETED COUNT OFF"}`);
  }
}

async function main() {
  if (flag("--inventory")) {
    await inventory();
    return;
  }
  const apply = flag("--yes");
  const only = value("--only");
  const grace = Number(value("--grace-days") ?? 5);
  if (!Number.isInteger(grace) || grace < 0) throw new Error("--grace-days must be a whole number of business days");

  const problems = await checkTargets();
  if (problems.length > 0) {
    console.log("The streamlined templates are not ready; nothing was changed.");
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: ACTOR_EMAIL }, select: { id: true } });
  const all = await loadInstances();
  const instances = only ? all.filter((i) => labelOf(i) === only) : all;
  if (only && instances.length === 0) throw new Error(`No workflow on "${only}"`);

  console.log(apply ? `Migrating to the streamlined workflow (grace ${grace} business days)…` : "Dry run — nothing is written. Add --yes to apply.");
  const tally: Record<string, number> = {};
  for (const i of instances) {
    if (isClosed(i) && !flag("--include-closed")) {
      console.log(`  ${labelOf(i)}: closed — left on ${pinsOf(i)}`);
      tally.closed = (tally.closed ?? 0) + 1;
      continue;
    }
    // An instance pinned to the streamlined versions was applied that way,
    // was migrated, or is a migration that was cut short — migrateInstance
    // tells them apart (the last one has work left and is simply resumed).
    try {
      const r = await migrateInstance({ instanceId: i.id, mapping: MAPPING, actorUserId: actor.id, dryRun: !apply, force: flag("--force"), graceBusinessDays: grace });
      if (r.outcome === "already-migrated") console.log(`  ${labelOf(i)}: already on the streamlined workflow (${pinsOf(i)})`);
      else report(r);
      tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    } catch (err) {
      // One instance failing must not stop the rest; a re-run picks it up where it stopped.
      console.log(`  ${labelOf(i)}: FAILED — ${err instanceof Error ? err.message : String(err)} — run again to resume`);
      tally.failed = (tally.failed ?? 0) + 1;
      process.exitCode = 1;
    }
  }
  console.log(Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(" · ") || "nothing to do");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
