import { Prisma, type RoleName, type WorkflowPermitStatus, type WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit/record";
import { createTask } from "@/lib/tasks/create";
import { compose, type ComposedPlan, type ComposedTask, type ComposeModule } from "./compose";
import { criticalPathBusinessDays } from "./dependencies";
import { CORE_MODULE_KEY, sourceKeyFor, type ScopeToggleState } from "./keys";
import { loadPublishedVersion, toComposeModule } from "./load";
import { notifyTasksReady } from "./notify";
import { loadRoleContext, resolveAssignee, unassignedRoles, type RoleContext } from "./roles";
import { activationDueAt, initialDueAt, type ScheduleContext } from "./schedule";

/**
 * Apply Workflow: compose the plan, then create exactly the tasks that do
 * not exist yet, in one transaction.
 *
 * Idempotency is layered. `materializePlan` looks up existing steps by
 * (instance, key) and skips them; the unique index on the same pair is the
 * backstop when two applies race, in which case the loser retries once
 * against the winner's rows and creates nothing. A second identical Apply
 * therefore reports "0 created" and changes nothing.
 */

export class WorkflowApplyError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowApplyError";
  }
}

export type ApplyInput = {
  jobId: string;
  /** Trade template keys. Core is always included. */
  templateKeys: string[];
  permitStatus: WorkflowPermitStatus;
  scopeToggles: ScopeToggleState;
  team?: Partial<Record<WorkflowRole, string | null>>;
  targetStartDate?: Date | null;
  jurisdiction?: string | null;
  permit?: { notes?: string | null; documentFileId?: string | null };
  actor: { id: string; role: RoleName };
};

export type PreviewTask = {
  key: string;
  phaseKey: string;
  title: string;
  role: WorkflowRole;
  assigneeId: string | null;
  dueAt: string | null;
  initiallyActive: boolean;
  blocking: boolean;
  exists: boolean;
};

export type WorkflowPreview = {
  modules: ComposedPlan["modules"];
  phases: { key: string; name: string; moduleName: string; band: number; note: string | null; taskCount: number }[];
  tasks: PreviewTask[];
  counts: { tasks: number; toCreate: number; existing: number; phases: number; initiallyActive: number; waiting: number; blocking: number };
  estimatedBusinessDays: number;
  rolesUsed: WorkflowRole[];
  unassignedRoles: WorkflowRole[];
  potentialDuplicates: { taskId: string; title: string; matchesKey: string }[];
  warnings: string[];
};

type Db = Prisma.TransactionClient | typeof prisma;

async function loadModules(db: Db, templateKeys: string[]): Promise<ComposeModule[]> {
  const keys = Array.from(new Set([CORE_MODULE_KEY, ...templateKeys.filter((k) => k !== CORE_MODULE_KEY)]));
  const out: ComposeModule[] = [];
  for (const key of keys) {
    const v = await loadPublishedVersion(db, key);
    if (!v) {
      throw new WorkflowApplyError(
        key === CORE_MODULE_KEY ? 409 : 400,
        key === CORE_MODULE_KEY
          ? "The Core Construction template has no published version — run the workflow seed"
          : `No published workflow template "${key}"`,
      );
    }
    out.push(toComposeModule(v));
  }
  return out;
}

async function loadJob(db: Db, jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      leadId: true,
      createdAt: true,
      targetStartDate: true,
      projectManagerId: true,
      salesRepId: true,
      workflow: { select: { id: true, permitStatus: true, scopeToggles: true, appliedAt: true, modules: { where: { removedAt: null }, select: { templateKey: true } } } },
    },
  });
  if (!job) throw new WorkflowApplyError(404, "Job not found");
  return job;
}

function dueFor(task: ComposedTask, ctx: ScheduleContext, now: Date): Date | null {
  const step = { anchor: task.anchor, dueOffsetBusinessDays: task.dueOffsetBusinessDays };
  return task.initiallyActive ? activationDueAt(step, now, ctx) : initialDueAt(step, ctx);
}

export async function previewWorkflow(input: ApplyInput): Promise<WorkflowPreview> {
  const now = new Date();
  const job = await loadJob(prisma, input.jobId);
  const modules = await loadModules(prisma, input.templateKeys);
  const plan = compose({ modules, permitStatus: input.permitStatus, scopeToggles: input.scopeToggles });
  const roleCtx = await loadRoleContext(prisma, { jobId: job.id, instanceId: job.workflow?.id, teamOverride: input.team });
  const ctx: ScheduleContext = {
    jobCreatedAt: job.createdAt,
    appliedAt: job.workflow?.appliedAt ?? now,
    targetStartDate: input.targetStartDate === undefined ? job.targetStartDate : input.targetStartDate,
  };

  const existingKeys = new Set(
    job.workflow
      ? (await prisma.task.findMany({ where: { workflowInstanceId: job.workflow.id, workflowTaskKey: { not: null } }, select: { workflowTaskKey: true } })).map((t) => t.workflowTaskKey!)
      : [],
  );
  const openManual = await prisma.task.findMany({
    where: { jobId: job.id, workflowTaskKey: null, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } },
    select: { id: true, title: true },
  });
  const byTitle = new Map(openManual.map((t) => [t.title.trim().toLowerCase(), t]));

  const tasks: PreviewTask[] = plan.tasks.map((t) => ({
    key: t.key,
    phaseKey: t.phaseKey,
    title: t.title,
    role: t.role,
    assigneeId: resolveAssignee(t.role, roleCtx),
    dueAt: dueFor(t, ctx, now)?.toISOString() ?? null,
    initiallyActive: t.initiallyActive,
    blocking: t.blocking,
    exists: existingKeys.has(t.key),
  }));
  const potentialDuplicates = plan.tasks.flatMap((t) => {
    const m = byTitle.get(t.title.trim().toLowerCase());
    return m ? [{ taskId: m.id, title: m.title, matchesKey: t.key }] : [];
  });
  const rolesUsed = Array.from(new Set(plan.tasks.map((t) => t.role)));
  const toCreate = tasks.filter((t) => !t.exists).length;

  return {
    modules: plan.modules,
    phases: plan.phases.map((p) => ({ key: p.key, name: p.name, moduleName: p.moduleName, band: p.band, note: p.note, taskCount: p.taskKeys.length })),
    tasks,
    counts: {
      tasks: tasks.length,
      toCreate,
      existing: tasks.length - toCreate,
      phases: plan.phases.length,
      initiallyActive: tasks.filter((t) => t.initiallyActive).length,
      waiting: tasks.filter((t) => !t.initiallyActive).length,
      blocking: tasks.filter((t) => t.blocking).length,
    },
    estimatedBusinessDays: criticalPathBusinessDays(
      plan.tasks.map((t) => ({ key: t.key, days: t.durationBusinessDays ?? Math.max(0, t.dueOffsetBusinessDays) })),
      plan.edges,
    ),
    rolesUsed,
    unassignedRoles: unassignedRoles(rolesUsed, roleCtx),
    potentialDuplicates,
    warnings: plan.warnings,
  };
}

export type MaterializeResult = { created: string[]; existing: number; edgesAdded: number; edgesRemoved: number; activated: string[] };

export type EdgeRow = { id: string; taskId: string; dependsOnTaskId: string; kind: "BLOCKING" | "DATE_ONLY" };

/**
 * Pure: which workflow-sourced edges to add and remove so the graph among
 * `idByKey` matches the plan. Edges to tasks outside the plan (removed
 * modules, corrections, manual tasks) are left alone.
 */
export function diffEdges(
  plan: ComposedPlan,
  idByKey: Map<string, string>,
  current: EdgeRow[],
): { toAdd: { taskId: string; dependsOnTaskId: string; kind: "BLOCKING" | "DATE_ONLY" }[]; stale: EdgeRow[] } {
  const wanted = new Map<string, { taskId: string; dependsOnTaskId: string; kind: "BLOCKING" | "DATE_ONLY" }>();
  for (const e of plan.edges) {
    const taskId = idByKey.get(e.task);
    const dependsOnTaskId = idByKey.get(e.dependsOn);
    if (!taskId || !dependsOnTaskId) continue;
    wanted.set(`${taskId}|${dependsOnTaskId}`, { taskId, dependsOnTaskId, kind: e.kind });
  }
  const stepIds = new Set(idByKey.values());
  const currentKeys = new Set(current.map((d) => `${d.taskId}|${d.dependsOnTaskId}`));
  const toAdd = Array.from(wanted.entries()).filter(([k]) => !currentKeys.has(k)).map(([, v]) => v);
  const stale = current.filter((d) => !wanted.has(`${d.taskId}|${d.dependsOnTaskId}`) && stepIds.has(d.dependsOnTaskId) && stepIds.has(d.taskId));
  return { toAdd, stale };
}

/**
 * Bring an instance's tasks and edges in line with a composed plan by ADDING
 * only: missing steps are created, missing edges are added, and
 * workflow-sourced edges the plan no longer has are removed. Never deletes a
 * task, never touches a manual task or a manual edge.
 */
export async function materializePlan(
  tx: Prisma.TransactionClient,
  args: {
    instanceId: string;
    jobId: string;
    plan: ComposedPlan;
    roleCtx: RoleContext;
    ctx: ScheduleContext;
    actorUserId: string;
    now?: Date;
  },
): Promise<MaterializeResult> {
  const now = args.now ?? new Date();
  const existing = await tx.task.findMany({
    where: { workflowInstanceId: args.instanceId, workflowTaskKey: { not: null } },
    select: { id: true, workflowTaskKey: true },
  });
  const idByKey = new Map(existing.map((t) => [t.workflowTaskKey!, t.id]));
  const created: string[] = [];
  const activated: string[] = [];

  for (const t of args.plan.tasks) {
    if (idByKey.has(t.key)) continue;
    const assignedUserId = resolveAssignee(t.role, args.roleCtx);
    const row = await createTask(
      {
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueAt: dueFor(t, args.ctx, now),
        assignedUserId,
        createdByUserId: args.actorUserId,
        jobId: args.jobId,
        source: "workflow",
        sourceKey: sourceKeyFor(args.instanceId, t.key),
        activatedAt: t.initiallyActive ? now : null,
        workflow: {
          instanceId: args.instanceId,
          taskKey: t.key,
          phaseKey: t.phaseKey,
          moduleKey: t.moduleKey,
          role: t.role,
          sortOrder: t.sortOrder,
          anchor: t.anchor,
          dueOffsetBusinessDays: t.dueOffsetBusinessDays,
          blocking: t.blocking,
          requiredEvidence: t.requiredEvidence,
          requiredEvidenceParam: t.requiredEvidenceParam,
          checklist: t.checklist,
        },
      },
      { db: tx, actorUserId: args.actorUserId, notify: "none", logLeadActivity: false },
    );
    idByKey.set(t.key, row.id);
    created.push(row.id);
    if (t.initiallyActive && assignedUserId) activated.push(row.id);
  }

  // Only the plan's own keys take part in the edge diff; tasks that left the
  // plan (removed module, corrections) keep whatever edges they have.
  const planKeys = new Set(args.plan.tasks.map((t) => t.key));
  const planIdByKey = new Map(Array.from(idByKey.entries()).filter(([k]) => planKeys.has(k)));
  const stepIds = Array.from(planIdByKey.values());
  const current = await tx.taskDependency.findMany({
    where: { taskId: { in: stepIds }, source: "workflow" },
    select: { id: true, taskId: true, dependsOnTaskId: true, kind: true },
  });
  const { toAdd, stale } = diffEdges(args.plan, planIdByKey, current);
  if (toAdd.length > 0) {
    await tx.taskDependency.createMany({
      data: toAdd.map((d) => ({ ...d, source: "workflow", createdByUserId: args.actorUserId })),
      skipDuplicates: true,
    });
  }
  if (stale.length > 0) {
    await tx.taskDependency.deleteMany({ where: { id: { in: stale.map((d) => d.id) } } });
  }

  return { created, existing: existing.length, edgesAdded: toAdd.length, edgesRemoved: stale.length, activated };
}

export type ApplyResult = {
  instanceId: string;
  created: number;
  existing: number;
  modules: string[];
  unassignedRoles: WorkflowRole[];
  warnings: string[];
};

export async function applyWorkflow(input: ApplyInput): Promise<ApplyResult> {
  const run = async (): Promise<ApplyResult & { activated: string[]; taskCount: number }> => {
    const now = new Date();
    const job = await loadJob(prisma, input.jobId);
    const modules = await loadModules(prisma, input.templateKeys);

    if (job.workflow) {
      // Re-apply: only the identical configuration (idempotent) or new trades.
      if (job.workflow.permitStatus !== input.permitStatus) {
        throw new WorkflowApplyError(409, "This job already has a workflow. Change the permit status from the Workflow tab instead of re-applying.");
      }
    }

    const plan = compose({ modules, permitStatus: input.permitStatus, scopeToggles: input.scopeToggles });
    const roleCtx = await loadRoleContext(prisma, { jobId: job.id, instanceId: job.workflow?.id, teamOverride: input.team });
    const rolesUsed = Array.from(new Set(plan.tasks.map((t) => t.role)));

    const result = await prisma.$transaction(
      async (tx) => {
        if (input.targetStartDate !== undefined || input.jurisdiction !== undefined) {
          await tx.job.update({
            where: { id: job.id },
            data: {
              ...(input.targetStartDate !== undefined ? { targetStartDate: input.targetStartDate } : {}),
              ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
            },
          });
        }
        const decided = input.permitStatus !== "UNDETERMINED";
        const instance = await tx.jobWorkflowInstance.upsert({
          where: { jobId: job.id },
          create: {
            jobId: job.id,
            permitStatus: input.permitStatus,
            permitDeterminedByUserId: decided ? input.actor.id : null,
            permitDeterminedAt: decided ? now : null,
            permitNotes: input.permit?.notes ?? null,
            permitDocumentFileId: input.permit?.documentFileId ?? null,
            scopeToggles: input.scopeToggles as Prisma.InputJsonValue,
            appliedByUserId: input.actor.id,
            appliedAt: now,
          },
          update: { scopeToggles: input.scopeToggles as Prisma.InputJsonValue },
        });
        for (const [role, userId] of Object.entries(input.team ?? {}) as [WorkflowRole, string | null][]) {
          if (userId) {
            await tx.jobWorkflowTeamMember.upsert({
              where: { instanceId_role: { instanceId: instance.id, role } },
              create: { instanceId: instance.id, role, userId },
              update: { userId },
            });
          } else {
            await tx.jobWorkflowTeamMember.deleteMany({ where: { instanceId: instance.id, role } });
          }
        }
        for (const m of plan.modules) {
          const template = await tx.workflowTemplate.findUniqueOrThrow({ where: { key: m.moduleKey }, select: { id: true } });
          await tx.jobWorkflowModule.upsert({
            where: { instanceId_templateKey: { instanceId: instance.id, templateKey: m.moduleKey } },
            create: {
              instanceId: instance.id,
              templateId: template.id,
              templateKey: m.moduleKey,
              templateVersionId: m.versionId,
              addedByUserId: input.actor.id,
            },
            update: { removedAt: null, removedByUserId: null, removeReason: null },
          });
        }
        const ctx: ScheduleContext = {
          jobCreatedAt: job.createdAt,
          appliedAt: instance.appliedAt,
          targetStartDate: input.targetStartDate === undefined ? job.targetStartDate : input.targetStartDate,
        };
        const mat = await materializePlan(tx, { instanceId: instance.id, jobId: job.id, plan, roleCtx, ctx, actorUserId: input.actor.id, now });
        if (mat.created.length > 0) {
          await tx.activityLog.create({
            data: {
              leadId: job.leadId,
              activityType: "TASK_CREATED",
              title: `Workflow applied: ${plan.modules.map((m) => m.name).join(", ")} — ${mat.created.length} task${mat.created.length === 1 ? "" : "s"} created`,
              createdByUserId: input.actor.id,
            },
          });
        }
        return { instance, mat };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return {
      instanceId: result.instance.id,
      created: result.mat.created.length,
      existing: result.mat.existing,
      modules: plan.modules.map((m) => m.moduleKey),
      unassignedRoles: unassignedRoles(rolesUsed, roleCtx),
      warnings: plan.warnings,
      activated: result.mat.activated,
      taskCount: plan.tasks.length,
    };
  };

  let out: Awaited<ReturnType<typeof run>>;
  try {
    out = await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.warn("workflow apply raced another apply; retrying once", { jobId: input.jobId });
      try {
        out = await run();
      } catch (again) {
        if (again instanceof Prisma.PrismaClientKnownRequestError && again.code === "P2002") {
          throw new WorkflowApplyError(409, "Another apply is in progress for this job. Refresh and try again.");
        }
        throw again;
      }
    } else {
      throw err;
    }
  }

  await recordAudit({
    actorUserId: input.actor.id,
    entityType: "JobWorkflowInstance",
    entityId: out.instanceId,
    action: "workflow_apply",
    after: {
      jobId: input.jobId,
      modules: out.modules,
      permitStatus: input.permitStatus,
      scopeToggles: input.scopeToggles,
      created: out.created,
      existing: out.existing,
      taskCount: out.taskCount,
    },
  });
  notifyTasksReady(out.activated, input.actor.id);

  return {
    instanceId: out.instanceId,
    created: out.created,
    existing: out.existing,
    modules: out.modules,
    unassignedRoles: out.unassignedRoles,
    warnings: out.warnings,
  };
}
