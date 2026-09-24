import type { Prisma, RoleName, WorkflowPermitStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { updateTask } from "@/lib/tasks/update";
import { readScopeToggles } from "./load";
import { compose } from "./compose";
import { loadInstanceModules } from "./load";
import { DETERMINE_PERMIT_FULL_KEY, type ScopeToggleState } from "./keys";
import { materializePlan } from "./apply";
import { loadRoleContext } from "./roles";
import { loadScheduleContext, sweepActivation } from "./activation";

/**
 * Reconciliation, Stage 1 subset: deciding an UNDETERMINED permit status.
 *
 * Re-composes with the decision, creates the chosen branch's tasks (and
 * nothing else — completed and manual tasks are never touched), re-points
 * the edges that were waiting on the determination gate, and completes the
 * gate task itself so the branch wakes up. Changing an already-decided
 * status is the full reconcile with a preview, which lands in Stage 2.
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

export type DeterminePermitInput = {
  instanceId: string;
  status: Exclude<WorkflowPermitStatus, "UNDETERMINED">;
  notes?: string | null;
  documentFileId?: string | null;
  jurisdiction?: string | null;
  actor: { id: string; role: RoleName };
};

export async function determinePermit(input: DeterminePermitInput): Promise<{ created: number; activated: number }> {
  const now = new Date();
  const inst = await prisma.jobWorkflowInstance.findUnique({
    where: { id: input.instanceId },
    select: { id: true, jobId: true, permitStatus: true, scopeToggles: true, appliedAt: true },
  });
  if (!inst) throw new ReconcileError(404, "Workflow not found");
  if (inst.permitStatus !== "UNDETERMINED" && inst.permitStatus !== input.status) {
    throw new ReconcileError(409, "The permit status has already been decided. Changing it re-plans the workflow, which is coming in the next release.");
  }

  const modules = await loadInstanceModules(prisma, inst.id);
  const plan = compose({ modules, permitStatus: input.status, scopeToggles: (inst.scopeToggles ?? {}) as ScopeToggleState });
  const roleCtx = await loadRoleContext(prisma, { jobId: inst.jobId, instanceId: inst.id });
  const ctx = await loadScheduleContext(prisma, inst.id);
  if (!ctx) throw new ReconcileError(404, "Workflow not found");

  const mat = await prisma.$transaction(
    async (tx) => {
      await tx.jobWorkflowInstance.update({
        where: { id: inst.id },
        data: {
          permitStatus: input.status,
          permitDeterminedByUserId: input.actor.id,
          permitDeterminedAt: now,
          permitNotes: input.notes ?? null,
          permitDocumentFileId: input.documentFileId ?? null,
          lastReconciledAt: now,
        },
      });
      if (input.jurisdiction !== undefined) {
        await tx.job.update({ where: { id: inst.jobId }, data: { jurisdiction: input.jurisdiction } });
      }
      return materializePlan(tx, { instanceId: inst.id, jobId: inst.jobId, plan, roleCtx, ctx, actorUserId: input.actor.id, now });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // The determination is the gate task's whole job; deciding completes it,
  // which activates the branch through the normal transition path.
  const gate = await prisma.task.findFirst({
    where: { workflowInstanceId: inst.id, workflowTaskKey: DETERMINE_PERMIT_FULL_KEY, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } },
    select: { id: true },
  });
  if (gate) {
    await updateTask({
      id: gate.id,
      input: { status: "COMPLETED" },
      actorUserId: input.actor.id,
      actorRole: input.actor.role,
      notify: "after",
      internal: { bypassEvidence: true, tickChecklist: true },
    });
  }
  const activated = await sweepActivation(inst.id, input.actor.id, now);

  await recordAudit({
    actorUserId: input.actor.id,
    entityType: "JobWorkflowInstance",
    entityId: inst.id,
    action: "permit_status_change",
    before: { permitStatus: inst.permitStatus },
    after: { permitStatus: input.status, notes: input.notes ?? null, documentFileId: input.documentFileId ?? null, jurisdiction: input.jurisdiction ?? undefined, created: mat.created.length },
  });

  return { created: mat.created.length, activated: activated.length };
}

export type ReconcileScopeInput = {
  instanceId: string;
  scopeToggles: ScopeToggleState;
  actor: { id: string; role: RoleName };
};

/**
 * Scope toggles changed: create steps that are now in scope, skip open steps
 * that are now out of scope (with a reason that says so), reinstate steps
 * that were skipped for scope and are back in. Completed and manual tasks
 * are never touched.
 */
export async function reconcileScope(input: ReconcileScopeInput): Promise<{ created: number; skipped: number; reinstated: number }> {
  const now = new Date();
  const inst = await prisma.jobWorkflowInstance.findUnique({
    where: { id: input.instanceId },
    select: { id: true, jobId: true, permitStatus: true },
  });
  if (!inst) throw new ReconcileError(404, "Workflow not found");

  const modules = await loadInstanceModules(prisma, inst.id);
  const plan = compose({ modules, permitStatus: inst.permitStatus, scopeToggles: input.scopeToggles });
  const roleCtx = await loadRoleContext(prisma, { jobId: inst.jobId, instanceId: inst.id });
  const ctx = await loadScheduleContext(prisma, inst.id);
  if (!ctx) throw new ReconcileError(404, "Workflow not found");

  const mat = await prisma.$transaction(
    async (tx) => {
      await tx.jobWorkflowInstance.update({
        where: { id: inst.id },
        data: { scopeToggles: input.scopeToggles as unknown as Prisma.InputJsonValue, lastReconciledAt: now },
      });
      return materializePlan(tx, { instanceId: inst.id, jobId: inst.jobId, plan, roleCtx, ctx, actorUserId: input.actor.id, now });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const planned = new Set(plan.tasks.map((t) => t.key));
  const steps = await prisma.task.findMany({
    where: { workflowInstanceId: inst.id, workflowTaskKey: { not: null } },
    select: { id: true, workflowTaskKey: true, status: true, skipReason: true },
  });
  let skipped = 0;
  let reinstated = 0;
  for (const s of steps) {
    const inPlan = planned.has(s.workflowTaskKey!);
    if (!inPlan && (s.status === "PENDING" || s.status === "IN_PROGRESS" || s.status === "BLOCKED")) {
      await updateTask({
        id: s.id,
        input: { status: "CANCELLED", skipReason: SCOPE_SKIP_REASON },
        actorUserId: input.actor.id,
        actorRole: input.actor.role,
        notify: "none",
      });
      skipped++;
    } else if (inPlan && s.status === "CANCELLED" && s.skipReason === SCOPE_SKIP_REASON) {
      await updateTask({ id: s.id, input: { status: "PENDING" }, actorUserId: input.actor.id, actorRole: input.actor.role, notify: "none" });
      reinstated++;
    }
  }
  await sweepActivation(inst.id, input.actor.id, now);

  await recordAudit({
    actorUserId: input.actor.id,
    entityType: "JobWorkflowInstance",
    entityId: inst.id,
    action: "workflow_scope_change",
    after: { scopeToggles: input.scopeToggles, created: mat.created.length, skipped, reinstated },
  });
  return { created: mat.created.length, skipped, reinstated };
}

export const SCOPE_SKIP_REASON = "Scope changed — this step is no longer included";

/** Scope-toggle definitions for each applied module, for the UI. */
export async function instanceToggleDefinitions(instanceId: string) {
  const modules = await loadInstanceModules(prisma, instanceId);
  return modules.map((m) => ({ moduleKey: m.moduleKey, name: m.name, toggles: m.definition.scopeToggles }));
}

export { readScopeToggles };
