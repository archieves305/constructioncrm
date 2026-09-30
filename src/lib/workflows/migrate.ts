import type { Prisma, TaskStatus, WorkflowEvidenceType, WorkflowPermitStatus, WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { recordTaskEvent } from "@/lib/tasks/events";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { updateTask, type StepDefinitionPatch } from "@/lib/tasks/update";
import { maybeCompleteInstance, sweepActivation } from "./activation";
import { materializePlan } from "./apply";
import { compose, permitConditionMet, resolveToggles, scopeConditionMet, type ComposedPlan, type ComposedTask, type ComposeModule } from "./compose";
import { readChecklist } from "./evidence";
import { fullKey, type ScopeToggleState } from "./keys";
import { loadInstanceModules, loadPublishedVersion, toComposeModule } from "./load";
import { ENGINE_SKIP_PREFIX, MIGRATION_SKIP_REASON, SCOPE_SKIP_REASON } from "./reconcile";
import { loadRoleContext, resolveAssignee } from "./roles";
import { addBusinessDaysFrom, atDueHour } from "./schedule";
import { loadSubjectForInstance, scheduleContextFor, taskLinksFor } from "./subject";

/**
 * Move one workflow from the templates it was applied with onto the
 * current (streamlined) generation.
 *
 * Not `reconcile`: that upgrades one module at a time, its skip cascade
 * wakes and notifies steps that are about to be retired themselves, and it
 * never refreshes a row whose key lives on. A migration re-plans the whole
 * workflow at once, quietly:
 *
 *  - nothing is deleted; completed steps and steps a person skipped are
 *    never touched;
 *  - a step whose key lives on in the new generation is the same row,
 *    refreshed to the new wording, checklist and gate while it is open;
 *  - a new step is born already done when the earlier steps it replaces
 *    were all done (it keeps the date and the person), and otherwise says
 *    which of them were;
 *  - every other open step of the earlier generation is retired with one
 *    recognisable reason;
 *  - the permit status and decision are left exactly as they are.
 *
 * `planMigration` is pure and is the whole decision; `migrateInstance`
 * loads, plans and — unless it is a dry run — applies through `updateTask`
 * with no notifications, then wakes what is ready once.
 */

const CORRECTION_MARK = ":correction:";
const isOpen = (s: TaskStatus) => (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(s);
const engineSkipped = (r: { status: TaskStatus; skipReason: string | null }) => r.status === "CANCELLED" && Boolean(r.skipReason?.startsWith(ENGINE_SKIP_PREFIX));
const peopleSkipped = (r: { status: TaskStatus; skipReason: string | null }) => r.status === "CANCELLED" && !r.skipReason?.startsWith(ENGINE_SKIP_PREFIX);

/** The v1 → streamlined mapping, handed in by the caller (it lives with the seed specs). */
export type SlimMapping = {
  /** Streamlined full key → the earlier full keys it absorbs. A key that lives on lists itself. */
  absorbs: Record<string, string[]>;
  /** Earlier full keys that go away entirely → why. */
  dropped: Record<string, string>;
  /** Module → earlier toggle → streamlined toggle (several may share one; null = gone). */
  toggles: Record<string, Record<string, string | null>>;
  /** Earlier full phase key → streamlined full phase key, for manual and correction tasks. */
  phases: Record<string, string>;
};

export type MigrationRow = {
  id: string;
  /** workflowTaskKey; null on a manual task filed under the workflow. */
  key: string | null;
  title: string;
  status: TaskStatus;
  skipReason: string | null;
  assignedUserId: string | null;
  dueAt: Date | null;
  dueLocked: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
  blockedReason: string | null;
  phaseKey: string | null;
  sortOrder: number | null;
  role: WorkflowRole | null;
  blocking: boolean;
  requiredEvidence: WorkflowEvidenceType | null;
  requiredEvidenceParam: string | null;
  checklistLabels: string[];
  inspectionResult: string | null;
};

export type MigrationInput = {
  rows: MigrationRow[];
  /** What the instance pins now. */
  current: ComposeModule[];
  /** The published versions of the same templates. */
  target: ComposeModule[];
  permitStatus: WorkflowPermitStatus;
  scopeToggles: ScopeToggleState;
  mapping: SlimMapping;
};

export type StepRefresh = { title: string; description: string | null; priority: ComposedTask["priority"]; definition: StepDefinitionPatch };

export type MigrationPlan = {
  /** "resume": the pins already point at the target (an interrupted or repeated run). */
  state: "migrate" | "resume";
  /** Work in flight that a person has to settle first; a non-empty list means "do not migrate". */
  blockers: string[];
  scopeToggles: ScopeToggleState;
  /** Earlier scope options that were on and have no streamlined counterpart ("roofing.metal"). */
  droppedToggles: string[];
  plan: ComposedPlan;
  /** Streamlined keys with no row yet. */
  create: string[];
  /** Rows whose key lives on and that are not closed by a person: take the new definition. */
  refresh: { id: string; key: string; refresh: StepRefresh; reinstate: boolean; assignRole: WorkflowRole | null }[];
  /** Closed rows that live on, and manual tasks: move under the right phase. */
  rehome: { id: string; phaseKey: string; sortOrder: number | null }[];
  /** New steps born done: every earlier step they replace was done. */
  complete: { key: string; at: Date | null; byUserId: string | null; from: string[] }[];
  /** Open steps some of whose earlier steps were done, for the timeline. */
  notes: { key: string; done: string[] }[];
  /** What an open new step inherits from the open steps it replaces. */
  carry: { key: string; assigneeId: string | null; status: "IN_PROGRESS" | "BLOCKED" | null; blockedReason: string | null; dueAt: Date | null }[];
  /** Open rows to retire, with the reason each gets. */
  skip: { id: string; key: string; title: string; reason: string }[];
  /** Earlier steps on this job the mapping does not know (added in the editor); retired like the rest. */
  unmapped: string[];
  /** Left exactly as they are. */
  kept: { completed: number; peopleSkipped: number; alreadyRetired: number; manual: number };
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function mapToggles(input: MigrationInput): { next: ScopeToggleState; dropped: string[] } {
  const next: ScopeToggleState = {};
  const dropped: string[] = [];
  for (const t of input.target) {
    const map = input.mapping.toggles[t.moduleKey];
    const from = input.current.find((m) => m.moduleKey === t.moduleKey);
    if (!map || !from) {
      if (input.scopeToggles[t.moduleKey]) next[t.moduleKey] = { ...input.scopeToggles[t.moduleKey] };
      continue;
    }
    const effective = resolveToggles(from, input.scopeToggles);
    const out: Record<string, boolean> = {};
    for (const s of t.definition.scopeToggles) {
      const sources = Object.keys(map).filter((k) => map[k] === s.key);
      if (sources.length > 0) out[s.key] = sources.some((k) => effective[k] === true);
    }
    for (const [k, to] of Object.entries(map)) if (to === null && effective[k]) dropped.push(`${t.moduleKey}.${k}`);
    next[t.moduleKey] = out;
  }
  return { next, dropped };
}

/** A target step's definition for a row that is not in the composed plan (its branch or scope is off right now). */
function definitionOutsidePlan(m: ComposeModule, shortKey: string, toggles: Record<string, boolean>, permitStatus: WorkflowPermitStatus): StepRefresh | null {
  const t = m.definition.tasks.find((x) => x.key === shortKey);
  if (!t) return null;
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    definition: {
      phaseKey: fullKey(m.moduleKey, t.phaseKey),
      role: t.role,
      anchor: t.anchor,
      dueOffsetBusinessDays: t.dueOffsetBusinessDays,
      blocking: t.blocking,
      requiredEvidence: t.requiredEvidence,
      requiredEvidenceParam: t.requiredEvidenceParam,
      checklist: t.checklist
        .filter((c) => !c.condition || ((!c.condition.permit || permitConditionMet(c.condition.permit, permitStatus) === true) && scopeConditionMet(c.condition, toggles)))
        .map((c) => ({ key: c.key, label: c.label })),
    },
  };
}

const refreshOf = (t: ComposedTask): StepRefresh => ({
  title: t.title,
  description: t.description,
  priority: t.priority,
  definition: {
    phaseKey: t.phaseKey,
    sortOrder: t.sortOrder,
    role: t.role,
    anchor: t.anchor,
    dueOffsetBusinessDays: t.dueOffsetBusinessDays,
    blocking: t.blocking,
    requiredEvidence: t.requiredEvidence,
    requiredEvidenceParam: t.requiredEvidenceParam,
    checklist: t.checklist,
  },
});

/**
 * Does the row already carry this definition? A repeated run must not reset
 * a checklist someone has been ticking. Position is compared only on a
 * first migration: a job already on the target keeps the order its rows
 * were created in (adding a trade later shifts the plan's numbering, and
 * that is not a reason to touch the row).
 */
function upToDate(row: MigrationRow, r: StepRefresh, comparePosition: boolean): boolean {
  const d = r.definition;
  return (
    row.title === r.title &&
    row.phaseKey === d.phaseKey &&
    (!comparePosition || d.sortOrder === undefined || row.sortOrder === d.sortOrder) &&
    row.role === d.role &&
    row.blocking === d.blocking &&
    row.requiredEvidence === (d.requiredEvidence ?? null) &&
    row.requiredEvidenceParam === (d.requiredEvidenceParam ?? null) &&
    sameList(row.checklistLabels, (d.checklist ?? []).map((c) => c.label))
  );
}

export function planMigration(input: MigrationInput): MigrationPlan {
  const { mapping } = input;
  const currentKeys = input.current.map((m) => m.moduleKey).sort();
  const targetKeys = input.target.map((m) => m.moduleKey).sort();
  if (!sameList(currentKeys, targetKeys)) throw new Error(`Migration target must cover the same templates (${currentKeys.join(", ")} vs ${targetKeys.join(", ")})`);

  const resume = input.current.every((m) => input.target.find((t) => t.moduleKey === m.moduleKey)!.versionId === m.versionId);
  const { next: scopeToggles, dropped: droppedToggles } = resume ? { next: input.scopeToggles, dropped: [] as string[] } : mapToggles(input);
  const plan = compose({ modules: input.target, permitStatus: input.permitStatus, scopeToggles });

  const planByKey = new Map(plan.tasks.map((t) => [t.key, t]));
  const targetByModule = new Map(input.target.map((m) => [m.moduleKey, m]));
  const targetStepKeys = new Set(input.target.flatMap((m) => m.definition.tasks.map((t) => fullKey(m.moduleKey, t.key))));
  const targetPhaseKeys = new Set(input.target.flatMap((m) => m.definition.phases.map((p) => fullKey(m.moduleKey, p.key))));
  const mappedV1Keys = new Set([...Object.values(mapping.absorbs).flat(), ...Object.keys(mapping.dropped)]);

  const rowsByKey = new Map<string, MigrationRow>();
  for (const r of input.rows) if (r.key) rowsByKey.set(r.key, r);

  const out: MigrationPlan = {
    state: resume ? "resume" : "migrate",
    blockers: [],
    scopeToggles,
    droppedToggles,
    plan,
    create: plan.tasks.filter((t) => !rowsByKey.has(t.key)).map((t) => t.key),
    refresh: [],
    rehome: [],
    complete: [],
    notes: [],
    carry: [],
    skip: [],
    unmapped: [],
    kept: { completed: 0, peopleSkipped: 0, alreadyRetired: 0, manual: 0 },
  };

  for (const row of input.rows) {
    // ── A manual task filed under the workflow ─────────────────────────────
    if (!row.key) {
      out.kept.manual += 1;
      if (row.phaseKey && !targetPhaseKeys.has(row.phaseKey)) {
        const home = mapping.phases[row.phaseKey];
        if (home && targetPhaseKeys.has(home)) out.rehome.push({ id: row.id, phaseKey: home, sortOrder: null });
      }
      continue;
    }

    // ── A correction task: open means an inspection is mid-failure ─────────
    if (row.key.includes(CORRECTION_MARK)) {
      if (isOpen(row.status)) out.blockers.push(`"${row.title}" is an open correction from a failed inspection — close it (or skip it) first`);
      continue;
    }
    if (row.status === "BLOCKED" && row.inspectionResult === "FAIL") {
      out.blockers.push(`"${row.title}" is a failed inspection waiting on its corrections — settle it first`);
      continue;
    }

    // ── The key lives on in the target generation ──────────────────────────
    if (targetStepKeys.has(row.key)) {
      const planned = planByKey.get(row.key);
      if (row.status === "COMPLETED" || peopleSkipped(row)) {
        const phaseKey = planned?.phaseKey ?? row.phaseKey;
        if (phaseKey && (phaseKey !== row.phaseKey || (!resume && planned && planned.sortOrder !== row.sortOrder))) {
          out.rehome.push({ id: row.id, phaseKey, sortOrder: planned?.sortOrder ?? null });
        }
        continue;
      }
      const moduleKey = row.key.slice(0, row.key.indexOf(":"));
      const m = targetByModule.get(moduleKey)!;
      const refresh = planned ? refreshOf(planned) : definitionOutsidePlan(m, row.key.slice(moduleKey.length + 1), resolveToggles(m, scopeToggles), input.permitStatus);
      if (!refresh) continue;
      const reinstate = Boolean(planned) && engineSkipped(row);
      if (!upToDate(row, refresh, !resume) || reinstate) {
        out.refresh.push({
          id: row.id,
          key: row.key,
          refresh,
          reinstate,
          // A step that changed hands, or never had an owner, is offered to the new role's person.
          assignRole: isOpen(row.status) && (row.assignedUserId === null || row.role !== refresh.definition.role) ? (refresh.definition.role ?? null) : null,
        });
      }
      if (!planned && isOpen(row.status)) out.skip.push({ id: row.id, key: row.key, title: row.title, reason: SCOPE_SKIP_REASON });
      continue;
    }

    // ── A step of the earlier generation only ──────────────────────────────
    if (!mappedV1Keys.has(row.key)) out.unmapped.push(row.key);
    if (row.status === "COMPLETED") out.kept.completed += 1;
    else if (peopleSkipped(row)) out.kept.peopleSkipped += 1;
    else if (row.status === "CANCELLED") out.kept.alreadyRetired += 1;
    else out.skip.push({ id: row.id, key: row.key, title: row.title, reason: MIGRATION_SKIP_REASON });
  }

  // ── What each streamlined step inherits from the steps it replaces ───────
  for (const t of plan.tasks) {
    const sources = (mapping.absorbs[t.key] ?? []).filter((k) => k !== t.key);
    const own = rowsByKey.get(t.key);
    // The earlier steps that actually existed on this job: a step the engine
    // had already skipped (the other permit branch, a scope that was off) did not.
    const relevant = sources.map((k) => rowsByKey.get(k)).filter((r): r is MigrationRow => Boolean(r) && !engineSkipped(r!));
    if (relevant.length === 0) continue;
    const done = relevant.filter((r) => r.status === "COMPLETED");
    const livesOn = (mapping.absorbs[t.key] ?? []).includes(t.key);

    // A step that lives on answers for itself: done stays done, open stays open.
    if (livesOn) {
      if (own && isOpen(own.status) && done.length > 0) out.notes.push({ key: t.key, done: done.map((r) => r.title) });
      continue;
    }
    if (own && !isOpen(own.status)) continue;

    const allSettled = relevant.every((r) => r.status === "COMPLETED" || peopleSkipped(r));
    if (allSettled && done.length > 0) {
      const last = done.reduce((a, b) => ((b.completedAt?.getTime() ?? 0) > (a.completedAt?.getTime() ?? 0) ? b : a));
      out.complete.push({ key: t.key, at: last.completedAt, byUserId: last.completedByUserId, from: done.map((r) => r.title) });
      continue;
    }
    if (done.length > 0) out.notes.push({ key: t.key, done: done.map((r) => r.title) });

    const open = relevant.filter((r) => isOpen(r.status));
    const owners = Array.from(new Set(relevant.map((r) => r.assignedUserId).filter((id): id is string => Boolean(id))));
    const blocked = open.find((r) => r.status === "BLOCKED");
    const locked = open.filter((r) => r.dueLocked && r.dueAt).map((r) => r.dueAt!.getTime());
    const carry = {
      key: t.key,
      assigneeId: owners.length === 1 ? owners[0]! : null,
      status: blocked ? ("BLOCKED" as const) : open.some((r) => r.status === "IN_PROGRESS") ? ("IN_PROGRESS" as const) : null,
      blockedReason: blocked?.blockedReason ?? null,
      dueAt: locked.length > 0 ? new Date(Math.max(...locked)) : null,
    };
    if (carry.assigneeId || carry.status || carry.dueAt) out.carry.push(carry);
  }

  return out;
}

// ── Loading and applying ────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true,
  workflowTaskKey: true,
  title: true,
  status: true,
  skipReason: true,
  assignedUserId: true,
  dueAt: true,
  dueLocked: true,
  completedAt: true,
  completedByUserId: true,
  blockedReason: true,
  workflowPhaseKey: true,
  workflowSortOrder: true,
  workflowRole: true,
  blocking: true,
  requiredEvidence: true,
  requiredEvidenceParam: true,
  checklist: true,
  inspectionResult: true,
} satisfies Prisma.TaskSelect;

const toRow = (t: Prisma.TaskGetPayload<{ select: typeof ROW_SELECT }>): MigrationRow => ({
  id: t.id,
  key: t.workflowTaskKey,
  title: t.title,
  status: t.status,
  skipReason: t.skipReason,
  assignedUserId: t.assignedUserId,
  dueAt: t.dueAt,
  dueLocked: t.dueLocked,
  completedAt: t.completedAt,
  completedByUserId: t.completedByUserId,
  blockedReason: t.blockedReason,
  phaseKey: t.workflowPhaseKey,
  sortOrder: t.workflowSortOrder,
  role: t.workflowRole,
  blocking: t.blocking,
  requiredEvidence: t.requiredEvidence,
  requiredEvidenceParam: t.requiredEvidenceParam,
  checklistLabels: readChecklist(t.checklist).map((c) => c.label),
  inspectionResult: t.inspectionResult,
});

export const MIGRATION_AUDIT_ACTION = "workflow_migrate_slim";

export type MigrationOutcome =
  | "would-migrate"
  | "migrated"
  | "already-migrated"
  | "blocked"
  | "no-target";

export type MigrationResult = {
  instanceId: string;
  label: string;
  outcome: MigrationOutcome;
  detail?: string;
  plan?: MigrationPlan;
  before?: { pins: string[]; rows: Record<string, number> };
  after?: { pins: string[]; created: number; refreshed: number; completed: number; retired: number; activated: number; floored: number; rows: Record<string, number> };
};

const tallyRows = (rows: { status: TaskStatus }[]) => rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});

/**
 * Migrate one instance. `dryRun` loads and plans only. `graceBusinessDays`
 * is the earliest an open, active streamlined step may fall due afterwards —
 * a job re-planned today should not open on a wall of overdue steps.
 */
export async function migrateInstance(args: {
  instanceId: string;
  mapping: SlimMapping;
  actorUserId: string;
  dryRun?: boolean;
  /** Run again over an instance that already carries a completed migration. */
  force?: boolean;
  graceBusinessDays?: number;
  now?: Date;
}): Promise<MigrationResult> {
  const now = args.now ?? new Date();
  const subject = await loadSubjectForInstance(prisma, args.instanceId);
  if (!subject?.instance) throw new Error(`Workflow ${args.instanceId} not found`);
  const instance = subject.instance;
  const label = subject.label;

  const current = await loadInstanceModules(prisma, args.instanceId);
  const target: ComposeModule[] = [];
  for (const m of current) {
    const v = await loadPublishedVersion(prisma, m.moduleKey);
    if (!v) return { instanceId: args.instanceId, label, outcome: "no-target", detail: `${m.moduleKey} has no published version` };
    target.push(toComposeModule(v));
  }
  const pins = (mods: ComposeModule[]) => mods.map((m) => `${m.moduleKey}@v${m.version}`);

  const rows = (await prisma.task.findMany({ where: { workflowInstanceId: args.instanceId }, select: ROW_SELECT })).map(toRow);
  const plan = planMigration({
    rows,
    current,
    target,
    permitStatus: instance.permitStatus,
    scopeToggles: (instance.scopeToggles ?? {}) as ScopeToggleState,
    mapping: args.mapping,
  });
  const before = { pins: pins(current), rows: tallyRows(rows) };

  if (plan.state === "resume") {
    const done = await prisma.auditEvent.findFirst({ where: { entityType: "JobWorkflowInstance", entityId: args.instanceId, action: MIGRATION_AUDIT_ACTION }, select: { id: true } });
    if (done && !args.force) return { instanceId: args.instanceId, label, outcome: "already-migrated", before };
    // Applied on the target to begin with (or migrated and nothing left to do): not a migration.
    const nothing = [plan.create, plan.refresh, plan.rehome, plan.complete, plan.carry, plan.skip].every((l) => l.length === 0);
    if (nothing && !args.force) return { instanceId: args.instanceId, label, outcome: "already-migrated", before };
  }
  if (plan.blockers.length > 0) return { instanceId: args.instanceId, label, outcome: "blocked", detail: plan.blockers.join("; "), plan, before };
  if (args.dryRun) return { instanceId: args.instanceId, label, outcome: "would-migrate", plan, before };

  const roleCtx = await loadRoleContext(prisma, { subject, instanceId: args.instanceId });
  // Dates count from the migration, not from the day the long workflow was applied.
  const ctx = scheduleContextFor(subject, now);
  const quiet = { quiet: true } as const;
  const actor = args.actorUserId;

  // 1. Re-pin and create what is missing, together.
  const mat = await prisma.$transaction(
    async (tx) => {
      await tx.jobWorkflowInstance.update({
        where: { id: args.instanceId },
        data: { lastReconciledAt: now, scopeToggles: plan.scopeToggles as unknown as Prisma.InputJsonValue },
      });
      for (const m of target) {
        await tx.jobWorkflowModule.updateMany({ where: { instanceId: args.instanceId, templateKey: m.moduleKey, removedAt: null }, data: { templateVersionId: m.versionId } });
      }
      return materializePlan(tx, { instanceId: args.instanceId, links: taskLinksFor(subject), plan: plan.plan, roleCtx, ctx, actorUserId: actor, now });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  for (const id of mat.created) await recordTaskEvent({ taskId: id, actorUserId: actor, type: "RECONCILED", body: "added — streamlined workflow" });

  // Every later step is idempotent and goes through updateTask, quietly.
  const idByKey = new Map(
    (await prisma.task.findMany({ where: { workflowInstanceId: args.instanceId, workflowTaskKey: { not: null } }, select: { id: true, workflowTaskKey: true, assignedUserId: true, status: true } })).map(
      (t) => [t.workflowTaskKey!, t],
    ),
  );

  // 2. Rows that live on take the new definition.
  for (const r of plan.refresh) {
    await updateTask({
      id: r.id,
      input: { title: r.refresh.title, description: r.refresh.description ?? "", priority: r.refresh.priority, ...(r.reinstate ? { status: "PENDING" as const } : {}) },
      actorUserId: actor,
      notify: "none",
      internal: { ...quiet, definition: { ...r.refresh.definition, deactivate: r.reinstate } },
    });
    const assignee = r.assignRole ? resolveAssignee(r.assignRole, roleCtx) : null;
    if (assignee && assignee !== idByKey.get(r.key)?.assignedUserId) {
      // Its own write: a role default pointing at someone inactive must not stop the migration.
      await updateTask({ id: r.id, input: { assignedUserId: assignee }, actorUserId: actor, notify: "none", internal: quiet }).catch(() => undefined);
    }
    await recordTaskEvent({ taskId: r.id, actorUserId: actor, type: "RECONCILED", body: "updated to the streamlined workflow" });
  }
  for (const r of plan.rehome) {
    await updateTask({ id: r.id, input: {}, actorUserId: actor, notify: "none", internal: { ...quiet, definition: { phaseKey: r.phaseKey, ...(r.sortOrder !== null ? { sortOrder: r.sortOrder } : {}) } } });
  }

  // 3. What new steps inherit from the open steps they replace.
  for (const c of plan.carry) {
    const row = idByKey.get(c.key);
    if (!row || !isOpen(row.status)) continue;
    const input: Parameters<typeof updateTask>[0]["input"] = {};
    if (c.assigneeId && !row.assignedUserId) input.assignedUserId = c.assigneeId;
    if (c.status && row.status === "PENDING") {
      input.status = c.status;
      if (c.status === "BLOCKED") input.blockedReason = c.blockedReason ?? "Blocked on the earlier workflow";
    }
    if (c.dueAt) {
      input.dueAt = c.dueAt.toISOString();
      input.dueLocked = true;
    }
    if (Object.keys(input).length === 0) continue;
    try {
      await updateTask({ id: row.id, input, actorUserId: actor, notify: "none", internal: quiet });
    } catch {
      // An inactive assignee is the usual cause; the step simply stays as the template made it.
    }
  }

  // 4. Steps born done, and what was already done on the rest.
  for (const c of plan.complete) {
    const row = idByKey.get(c.key);
    if (!row || !isOpen(row.status)) continue;
    await updateTask({
      id: row.id,
      input: { status: "COMPLETED" },
      actorUserId: actor,
      notify: "none",
      internal: { ...quiet, bypassEvidence: true, tickChecklist: true, completion: c.at ? { at: c.at, byUserId: c.byUserId } : undefined },
    });
    await recordTaskEvent({ taskId: row.id, actorUserId: actor, type: "RECONCILED", body: `completed on the earlier workflow as: ${c.from.join("; ")}` });
  }
  for (const n of plan.notes) {
    const row = idByKey.get(n.key);
    if (row && isOpen(row.status)) await recordTaskEvent({ taskId: row.id, actorUserId: actor, type: "RECONCILED", body: `already done on the earlier workflow: ${n.done.join("; ")}` });
  }

  // 5. Retire the rest of the earlier generation.
  for (const s of plan.skip) {
    await updateTask({ id: s.id, input: { status: "CANCELLED", skipReason: s.reason }, actorUserId: actor, notify: "none", internal: { ...quiet, bypassGate: true } });
  }

  // 6. Wake what is ready, once, and give it room.
  const activated = await sweepActivation(args.instanceId, actor, now, { notify: false });
  const floor = atDueHour(addBusinessDaysFrom(now, args.graceBusinessDays ?? 5));
  const planKeys = plan.plan.tasks.map((t) => t.key);
  const due = await prisma.task.findMany({
    where: {
      workflowInstanceId: args.instanceId,
      workflowTaskKey: { in: planKeys },
      status: { in: [...OPEN_TASK_STATUSES] },
      activatedAt: { not: null },
      dueLocked: false,
      // A legal deadline and a hearing date are what they are.
      NOT: { workflowAnchor: { in: ["COMPLIANCE_DEADLINE", "HEARING_DATE"] } },
      OR: [{ dueAt: null }, { dueAt: { lt: floor } }],
    },
    select: { id: true },
  });
  for (const t of due) {
    await updateTask({ id: t.id, input: { dueAt: floor.toISOString(), dueLocked: false }, actorUserId: actor, notify: "none", internal: quiet });
  }
  await maybeCompleteInstance(args.instanceId);

  const afterRows = await prisma.task.findMany({ where: { workflowInstanceId: args.instanceId }, select: { status: true } });
  const after = {
    pins: pins(target),
    created: mat.created.length,
    refreshed: plan.refresh.length,
    completed: plan.complete.length,
    retired: plan.skip.length,
    activated: activated.length,
    floored: due.length,
    rows: tallyRows(afterRows),
  };
  await prisma.activityLog.create({
    data: {
      leadId: subject.leadId,
      activityType: "TASK_CREATED",
      title: `Workflow moved to the streamlined version — ${plan.plan.tasks.length} steps (${plan.complete.length} already done), ${plan.skip.length} earlier steps retired`,
      createdByUserId: actor,
    },
  });
  await recordAudit({
    actorUserId: actor,
    entityType: "JobWorkflowInstance",
    entityId: args.instanceId,
    action: MIGRATION_AUDIT_ACTION,
    before: { pins: before.pins, scopeToggles: instance.scopeToggles, rows: before.rows },
    after: { ...after, scopeToggles: plan.scopeToggles, droppedToggles: plan.droppedToggles, unmapped: plan.unmapped },
  });

  return { instanceId: args.instanceId, label, outcome: "migrated", plan, before, after };
}
