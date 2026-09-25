import type { Prisma, RoleName, TaskStatus, WorkflowPermitStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { updateTask } from "@/lib/tasks/update";
import { recordTaskEvent } from "@/lib/tasks/events";
import { compose, type ComposedPlan, type ComposeModule } from "./compose";
import { loadInstanceModules, loadPublishedVersion, loadVersionById, readScopeToggles, toComposeModule } from "./load";
import { CORE_MODULE_KEY, isBaseKind, type ScopeToggleState } from "./keys";
import { diffEdges, materializePlan, type EdgeRow } from "./apply";
import { loadRoleContext } from "./roles";
import { loadScheduleContext, sweepActivation } from "./activation";
import { isCorrectionKey } from "./inspections";
import { loadSubjectForInstance, taskLinksFor, writeSubjectFields } from "./subject";

/**
 * Reconciliation: the workflow's shape changed after it was applied —
 * permit decided or reversed, a trade added or removed, scope toggled, a
 * template version upgraded. Every change goes through the same three
 * steps: build the new plan, diff it against what the job already has,
 * apply the diff by ADDING, REINSTATING or SKIPPING. Nothing is ever
 * deleted; completed and manual tasks are never touched; user-made skips
 * stay skipped (only engine skips are reinstated).
 *
 * `previewReconcile` returns the diff without writing, so the UI can show
 * "To add / To skip / Kept" before "Confirm — Reconcile Workflow".
 */

export class ReconcileError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ReconcileError";
  }
}

/** Engine-made skips carry this prefix so a re-plan can tell them from a person's. */
export const ENGINE_SKIP_PREFIX = "Workflow: ";
export const SCOPE_SKIP_REASON = `${ENGINE_SKIP_PREFIX}scope changed — this step is no longer included`;

export type ReconcileChange =
  | {
      kind: "permit";
      status: Exclude<WorkflowPermitStatus, "UNDETERMINED">;
      /** Required when dropping the requirement (REQUIRED → NOT_REQUIRED). */
      reason?: string | null;
      notes?: string | null;
      documentFileId?: string | null;
      jurisdiction?: string | null;
    }
  | { kind: "add-module"; templateKeys: string[]; scopeToggles?: ScopeToggleState }
  | {
      kind: "remove-module";
      templateKey: string;
      reason: string;
      /** Open steps of the module to keep as-is instead of skipping. */
      retainTaskIds?: string[];
    }
  | { kind: "scope"; scopeToggles: ScopeToggleState }
  | { kind: "upgrade-module"; templateKey: string; versionId?: string };

export type ReconcileItem = {
  id: string | null;
  key: string;
  title: string;
  moduleKey: string;
  phaseKey: string | null;
  status: TaskStatus | null;
  blocking: boolean;
};

export type ReconcilePlan = {
  change: ReconcileChange;
  label: string;
  permitStatus: WorkflowPermitStatus;
  modules: { moduleKey: string; name: string; version: number }[];
  toCreate: ReconcileItem[];
  toReinstate: ReconcileItem[];
  toSkip: ReconcileItem[];
  preserved: (ReconcileItem & { why: "completed" | "manual" | "retained" | "correction" | "user-skipped" })[];
  edgesToAdd: number;
  edgesToRemove: number;
  drift: { key: string; field: "title" | "description"; from: string | null; to: string | null }[];
  warnings: string[];
};

type Instance = Prisma.JobWorkflowInstanceGetPayload<{
  select: { id: true; jobId: true; violationCaseId: true; permitStatus: true; scopeToggles: true; appliedAt: true; modules: { select: { templateKey: true; templateVersionId: true; removedAt: true } } };
}>;

type Built = {
  modules: ComposeModule[];
  permitStatus: WorkflowPermitStatus;
  scopeToggles: ScopeToggleState;
  plan: ComposedPlan;
  label: string;
  drift: ReconcilePlan["drift"];
  warnings: string[];
  /** Module rows to write on apply. */
  moduleWrites: { add: ComposeModule[]; remove: string[]; repin: { templateKey: string; versionId: string }[] };
};

async function loadInstance(instanceId: string): Promise<Instance> {
  const inst = await prisma.jobWorkflowInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, jobId: true, violationCaseId: true, permitStatus: true, scopeToggles: true, appliedAt: true, modules: { select: { templateKey: true, templateVersionId: true, removedAt: true } } },
  });
  if (!inst) throw new ReconcileError(404, "Workflow not found");
  return inst;
}

/** A violation case runs one template; adding or removing modules is a job-only change. */
function isCase(inst: Instance): boolean {
  return Boolean(inst.violationCaseId);
}

/** Compose the plan the job SHOULD have after `change`. */
async function build(inst: Instance, change: ReconcileChange): Promise<Built> {
  let modules = await loadInstanceModules(prisma, inst.id);
  let permitStatus = inst.permitStatus;
  let scopeToggles = (inst.scopeToggles ?? {}) as ScopeToggleState;
  const warnings: string[] = [];
  const drift: ReconcilePlan["drift"] = [];
  const moduleWrites: Built["moduleWrites"] = { add: [], remove: [], repin: [] };
  let label = "";

  switch (change.kind) {
    case "permit": {
      if (inst.permitStatus === change.status) throw new ReconcileError(409, `The permit status is already ${change.status === "REQUIRED" ? "required" : "not required"}`);
      if (inst.permitStatus === "REQUIRED" && change.status === "NOT_REQUIRED" && !change.reason?.trim()) {
        throw new ReconcileError(400, "Say why the permit is no longer required");
      }
      permitStatus = change.status;
      label = change.status === "REQUIRED" ? "permit status changed to Required" : "permit status changed to Not required";
      break;
    }
    case "add-module": {
      if (isCase(inst)) throw new ReconcileError(400, "A violation case runs a single template; trades belong on the linked job");
      const have = new Set(modules.map((m) => m.moduleKey));
      const keys = Array.from(new Set(change.templateKeys)).filter((k) => k !== CORE_MODULE_KEY);
      if (keys.length === 0) throw new ReconcileError(400, "Pick at least one trade to add");
      for (const key of keys) {
        if (have.has(key)) {
          warnings.push(`${key} is already on this job`);
          continue;
        }
        const v = await loadPublishedVersion(prisma, key);
        if (!v) throw new ReconcileError(400, `No published workflow template "${key}"`);
        const m = toComposeModule(v);
        if (m.kind !== "TRADE") throw new ReconcileError(400, `"${key}" is not a trade template`);
        modules.push(m);
        moduleWrites.add.push(m);
      }
      if (change.scopeToggles) scopeToggles = { ...scopeToggles, ...change.scopeToggles };
      label = `${moduleWrites.add.map((m) => m.name).join(", ") || "trade"} added`;
      break;
    }
    case "remove-module": {
      if (change.templateKey === CORE_MODULE_KEY) throw new ReconcileError(400, "Core Construction cannot be removed");
      if (isCase(inst)) throw new ReconcileError(400, "The violation template cannot be removed from a case");
      if (!change.reason?.trim()) throw new ReconcileError(400, "Say why this trade is being removed");
      const m = modules.find((x) => x.moduleKey === change.templateKey);
      if (!m) throw new ReconcileError(404, "That trade is not on this job");
      if (isBaseKind(m.kind)) throw new ReconcileError(400, `${m.name} is the base template and cannot be removed`);
      modules = modules.filter((x) => x.moduleKey !== change.templateKey);
      moduleWrites.remove.push(change.templateKey);
      label = `${m.name} removed — ${change.reason.trim()}`;
      break;
    }
    case "scope": {
      scopeToggles = change.scopeToggles;
      label = "scope changed";
      break;
    }
    case "upgrade-module": {
      const cur = modules.find((x) => x.moduleKey === change.templateKey);
      if (!cur) throw new ReconcileError(404, "That template is not on this job");
      const next = change.versionId ? await loadVersionById(prisma, change.versionId) : await loadPublishedVersion(prisma, change.templateKey);
      if (!next) throw new ReconcileError(404, "No published version to upgrade to");
      if (next.template.key !== change.templateKey) throw new ReconcileError(400, "That version belongs to a different template");
      if (next.id === cur.versionId) throw new ReconcileError(409, `${cur.name} is already on v${cur.version}`);
      const nm = toComposeModule(next);
      // Report content drift on steps that exist in both versions; the
      // existing task rows keep their titles — we never rewrite a person's task.
      const oldByKey = new Map(cur.definition.tasks.map((t) => [t.key, t]));
      for (const t of nm.definition.tasks) {
        const o = oldByKey.get(t.key);
        if (!o) continue;
        if (o.title !== t.title) drift.push({ key: `${nm.moduleKey}:${t.key}`, field: "title", from: o.title, to: t.title });
        if ((o.description ?? null) !== (t.description ?? null)) drift.push({ key: `${nm.moduleKey}:${t.key}`, field: "description", from: o.description, to: t.description });
      }
      modules = modules.map((x) => (x.moduleKey === change.templateKey ? nm : x));
      moduleWrites.repin.push({ templateKey: change.templateKey, versionId: next.id });
      label = `${nm.name} upgraded v${cur.version} → v${nm.version}`;
      break;
    }
  }

  const plan = compose({ modules, permitStatus, scopeToggles });
  return { modules, permitStatus, scopeToggles, plan, label, drift, warnings: [...warnings, ...plan.warnings], moduleWrites };
}

const STEP_SELECT = {
  id: true,
  title: true,
  status: true,
  skipReason: true,
  blocking: true,
  workflowTaskKey: true,
  workflowModuleKey: true,
  workflowPhaseKey: true,
} as const;

type StepRow = Prisma.TaskGetPayload<{ select: typeof STEP_SELECT }>;

const item = (t: StepRow): ReconcileItem => ({
  id: t.id,
  key: t.workflowTaskKey ?? "",
  title: t.title,
  moduleKey: t.workflowModuleKey ?? "",
  phaseKey: t.workflowPhaseKey,
  status: t.status,
  blocking: t.blocking,
});

const isOpen = (s: TaskStatus) => s === "PENDING" || s === "IN_PROGRESS" || s === "BLOCKED";

/** Pure-ish diff of the built plan against the instance's current tasks. */
async function diff(inst: Instance, built: Built, change: ReconcileChange): Promise<ReconcilePlan> {
  const rows = await prisma.task.findMany({ where: { workflowInstanceId: inst.id }, select: STEP_SELECT });
  const planned = new Map(built.plan.tasks.map((t) => [t.key, t]));
  const retain = new Set(change.kind === "remove-module" ? (change.retainTaskIds ?? []) : []);

  const toCreate: ReconcileItem[] = [];
  const toReinstate: ReconcileItem[] = [];
  const toSkip: ReconcileItem[] = [];
  const preserved: ReconcilePlan["preserved"] = [];
  const byKey = new Map(rows.filter((r) => r.workflowTaskKey).map((r) => [r.workflowTaskKey!, r]));

  for (const t of built.plan.tasks) {
    const row = byKey.get(t.key);
    if (!row) {
      toCreate.push({ id: null, key: t.key, title: t.title, moduleKey: t.moduleKey, phaseKey: t.phaseKey, status: null, blocking: t.blocking });
    } else if (row.status === "CANCELLED" && row.skipReason?.startsWith(ENGINE_SKIP_PREFIX)) {
      toReinstate.push(item(row));
    } else if (row.status === "CANCELLED") {
      preserved.push({ ...item(row), why: "user-skipped" });
    }
  }
  for (const r of rows) {
    if (!r.workflowTaskKey) {
      preserved.push({ ...item(r), why: "manual" });
      continue;
    }
    if (isCorrectionKey(r.workflowTaskKey)) {
      preserved.push({ ...item(r), why: "correction" });
      continue;
    }
    if (planned.has(r.workflowTaskKey)) continue;
    if (!isOpen(r.status)) {
      if (r.status === "COMPLETED") preserved.push({ ...item(r), why: "completed" });
      continue;
    }
    if (retain.has(r.id)) preserved.push({ ...item(r), why: "retained" });
    else toSkip.push(item(r));
  }

  // Edge diff over the plan's keys (created steps count as present).
  const idByKey = new Map<string, string>();
  for (const [k, r] of byKey) if (planned.has(k)) idByKey.set(k, r.id);
  for (const t of toCreate) idByKey.set(t.key, `new:${t.key}`);
  const current = (await prisma.taskDependency.findMany({
    where: { taskId: { in: Array.from(byKey.values()).map((r) => r.id) }, source: "workflow" },
    select: { id: true, taskId: true, dependsOnTaskId: true, kind: true },
  })) as EdgeRow[];
  const edges = diffEdges(built.plan, idByKey, current);

  return {
    change,
    label: built.label,
    permitStatus: built.permitStatus,
    modules: built.modules.map((m) => ({ moduleKey: m.moduleKey, name: m.name, version: m.version })),
    toCreate,
    toReinstate,
    toSkip,
    preserved,
    edgesToAdd: edges.toAdd.length,
    edgesToRemove: edges.stale.length,
    drift: built.drift,
    warnings: built.warnings,
  };
}

export async function previewReconcile(instanceId: string, change: ReconcileChange): Promise<ReconcilePlan> {
  const inst = await loadInstance(instanceId);
  const built = await build(inst, change);
  return diff(inst, built, change);
}

export type ReconcileResult = { plan: ReconcilePlan; created: number; reinstated: number; skipped: number; activated: number };

export async function reconcile(instanceId: string, change: ReconcileChange, actor: { id: string; role: RoleName }): Promise<ReconcileResult> {
  const now = new Date();
  const inst = await loadInstance(instanceId);
  const built = await build(inst, change);
  const plan = await diff(inst, built, change);
  const subject = await loadSubjectForInstance(prisma, inst.id);
  if (!subject) throw new ReconcileError(404, "Workflow not found");
  const roleCtx = await loadRoleContext(prisma, { subject, instanceId: inst.id });
  const ctx = await loadScheduleContext(prisma, inst.id);
  if (!ctx) throw new ReconcileError(404, "Workflow not found");
  const skipReason = `${ENGINE_SKIP_PREFIX}${built.label}`;

  const mat = await prisma.$transaction(
    async (tx) => {
      const data: Prisma.JobWorkflowInstanceUpdateInput = { lastReconciledAt: now, scopeToggles: built.scopeToggles as unknown as Prisma.InputJsonValue };
      if (change.kind === "permit") {
        data.permitStatus = change.status;
        data.permitDeterminedBy = { connect: { id: actor.id } };
        data.permitDeterminedAt = now;
        data.permitNotes = change.notes ?? (change.reason ? change.reason.trim() : null);
        data.permitDocumentFileId = change.documentFileId ?? null;
        if (change.jurisdiction !== undefined) await writeSubjectFields(tx, subject, { jurisdiction: change.jurisdiction });
      }
      await tx.jobWorkflowInstance.update({ where: { id: inst.id }, data });
      for (const m of built.moduleWrites.add) {
        const template = await tx.workflowTemplate.findUniqueOrThrow({ where: { key: m.moduleKey }, select: { id: true } });
        await tx.jobWorkflowModule.upsert({
          where: { instanceId_templateKey: { instanceId: inst.id, templateKey: m.moduleKey } },
          create: { instanceId: inst.id, templateId: template.id, templateKey: m.moduleKey, templateVersionId: m.versionId, addedByUserId: actor.id },
          update: { removedAt: null, removedByUserId: null, removeReason: null, templateVersionId: m.versionId },
        });
      }
      for (const key of built.moduleWrites.remove) {
        await tx.jobWorkflowModule.updateMany({
          where: { instanceId: inst.id, templateKey: key },
          data: { removedAt: now, removedByUserId: actor.id, removeReason: change.kind === "remove-module" ? change.reason : null },
        });
      }
      for (const r of built.moduleWrites.repin) {
        await tx.jobWorkflowModule.updateMany({ where: { instanceId: inst.id, templateKey: r.templateKey }, data: { templateVersionId: r.versionId } });
      }
      return materializePlan(tx, { instanceId: inst.id, links: taskLinksFor(subject), plan: built.plan, roleCtx, ctx, actorUserId: actor.id, now });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // Skips and reinstatements go through updateTask so timelines, mail
  // suppression and transitions all behave as for a person's edit.
  for (const t of plan.toSkip) {
    await updateTask({ id: t.id!, input: { status: "CANCELLED", skipReason }, actorUserId: actor.id, actorRole: actor.role, notify: "none", internal: { bypassGate: true } });
    await recordTaskEvent({ taskId: t.id!, actorUserId: actor.id, type: "RECONCILED", body: built.label });
  }
  for (const t of plan.toReinstate) {
    await updateTask({ id: t.id!, input: { status: "PENDING" }, actorUserId: actor.id, actorRole: actor.role, notify: "none" });
    // Back to Not active; the sweep below activates it if its predecessors are done.
    await prisma.task.update({ where: { id: t.id! }, data: { activatedAt: null } });
    await recordTaskEvent({ taskId: t.id!, actorUserId: actor.id, type: "RECONCILED", body: `reinstated — ${built.label}` });
  }
  for (const id of mat.created) {
    await recordTaskEvent({ taskId: id, actorUserId: actor.id, type: "RECONCILED", body: `added — ${built.label}` });
  }

  // Deciding a permit completes the determination gate; the decision IS its
  // evidence. The gate is Core's on a job and the violation template's own on a case.
  if (change.kind === "permit" && inst.permitStatus === "UNDETERMINED" && built.plan.permitGateKey) {
    const gate = await prisma.task.findFirst({
      where: { workflowInstanceId: inst.id, workflowTaskKey: built.plan.permitGateKey, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } },
      select: { id: true },
    });
    if (gate) {
      await updateTask({ id: gate.id, input: { status: "COMPLETED" }, actorUserId: actor.id, actorRole: actor.role, notify: "after", internal: { bypassEvidence: true, tickChecklist: true } });
    }
  }
  const activated = await sweepActivation(inst.id, actor.id, now);

  await recordAudit({
    actorUserId: actor.id,
    entityType: "JobWorkflowInstance",
    entityId: inst.id,
    action:
      change.kind === "permit" ? "permit_status_change"
      : change.kind === "remove-module" ? "workflow_module_remove"
      : change.kind === "upgrade-module" ? "template_version_reconcile"
      : change.kind === "scope" ? "workflow_scope_change"
      : "workflow_apply",
    before: { permitStatus: inst.permitStatus, modules: inst.modules.filter((m) => !m.removedAt).map((m) => m.templateKey), scopeToggles: inst.scopeToggles },
    after: {
      change,
      label: built.label,
      created: mat.created.length,
      reinstated: plan.toReinstate.length,
      skipped: plan.toSkip.length,
      edgesAdded: mat.edgesAdded,
      edgesRemoved: mat.edgesRemoved,
    },
  });

  return { plan, created: mat.created.length, reinstated: plan.toReinstate.length, skipped: plan.toSkip.length, activated: activated.length };
}

// ── Stage 1 entry points, kept as thin wrappers ─────────────────────────────

export type DeterminePermitInput = {
  instanceId: string;
  status: Exclude<WorkflowPermitStatus, "UNDETERMINED">;
  reason?: string | null;
  notes?: string | null;
  documentFileId?: string | null;
  jurisdiction?: string | null;
  actor: { id: string; role: RoleName };
};

export async function determinePermit(input: DeterminePermitInput): Promise<{ created: number; activated: number; skipped: number }> {
  const r = await reconcile(
    input.instanceId,
    { kind: "permit", status: input.status, reason: input.reason, notes: input.notes, documentFileId: input.documentFileId, jurisdiction: input.jurisdiction },
    input.actor,
  );
  return { created: r.created, activated: r.activated, skipped: r.skipped };
}

export async function reconcileScope(input: { instanceId: string; scopeToggles: ScopeToggleState; actor: { id: string; role: RoleName } }) {
  const r = await reconcile(input.instanceId, { kind: "scope", scopeToggles: input.scopeToggles }, input.actor);
  return { created: r.created, skipped: r.skipped, reinstated: r.reinstated };
}

/** Scope-toggle definitions for each applied module, for the UI. */
export async function instanceToggleDefinitions(instanceId: string) {
  const modules = await loadInstanceModules(prisma, instanceId);
  return modules.map((m) => ({ moduleKey: m.moduleKey, name: m.name, toggles: m.definition.scopeToggles }));
}

export { readScopeToggles };
