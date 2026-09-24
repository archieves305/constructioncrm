import type { Prisma, RoleName, WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { TASK_LIST_INCLUDE } from "@/lib/tasks/include";
import { taskVisibilityFilter, type VisibilityScope } from "@/lib/tasks/access";
import { loadInstanceModules } from "./load";
import { resolveToggles } from "./compose";
import { fullKey, splitFullKey, type ScopeToggleState } from "./keys";
import { unassignedRoles, loadRoleContext } from "./roles";
import { canApplyWorkflow, canCoordinateWorkflow, canOverrideBlockingGate, canSetPermitStatus, type JobScope } from "./access";

/**
 * Everything the Workflow tab needs in one read: the instance, its modules
 * and team, phases in band order with progress, the (visibility-scoped)
 * tasks with their dependencies, and what this viewer may do.
 */

export const WORKFLOW_TASK_INCLUDE = {
  ...TASK_LIST_INCLUDE,
  dependencies: {
    select: {
      kind: true,
      source: true,
      dependsOnTaskId: true,
      dependsOn: { select: { id: true, title: true, status: true, workflowTaskKey: true, activatedAt: true } },
    },
  },
  _count: { select: { events: { where: { type: "NOTE" } }, files: true, dependents: true } },
} satisfies Prisma.TaskInclude;

export type WorkflowTaskRow = Prisma.TaskGetPayload<{ include: typeof WORKFLOW_TASK_INCLUDE }>;

export type PhaseProgress = {
  total: number;
  done: number;
  skipped: number;
  ready: number;
  inProgress: number;
  blocked: number;
  notActive: number;
  overdue: number;
  unassigned: number;
};

function emptyProgress(): PhaseProgress {
  return { total: 0, done: 0, skipped: 0, ready: 0, inProgress: 0, blocked: 0, notActive: 0, overdue: 0, unassigned: 0 };
}

function tally(p: PhaseProgress, t: WorkflowTaskRow, now: Date) {
  p.total++;
  const open = t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED";
  if (t.status === "COMPLETED") p.done++;
  else if (t.status === "CANCELLED") p.skipped++;
  else if (t.status === "IN_PROGRESS") p.inProgress++;
  else if (t.status === "BLOCKED") p.blocked++;
  else if (t.activatedAt) p.ready++;
  else p.notActive++;
  if (open && t.activatedAt && t.dueAt && t.dueAt < now) p.overdue++;
  if (open && !t.assignedUserId && t.workflowTaskKey) p.unassigned++;
}

export async function readJobWorkflow(
  jobId: string,
  user: { id: string; role: RoleName },
  scope: VisibilityScope | undefined,
  jobScope: JobScope,
) {
  const now = new Date();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      leadId: true,
      jobNumber: true,
      title: true,
      serviceType: true,
      projectManagerId: true,
      salesRepId: true,
      targetStartDate: true,
      jurisdiction: true,
      createdAt: true,
      workflow: {
        include: {
          modules: {
            orderBy: { addedAt: "asc" },
            include: {
              template: { select: { key: true, name: true, kind: true, trade: true } },
              templateVersion: { select: { id: true, version: true } },
            },
          },
          team: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
          appliedBy: { select: { id: true, firstName: true, lastName: true } },
          permitDeterminedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!job) return null;

  const permissions = {
    canApply: canApplyWorkflow(user.role),
    canSetPermit: canSetPermitStatus(user, jobScope),
    canCoordinate: canCoordinateWorkflow(user, jobScope),
    canOverrideGate: canOverrideBlockingGate(user.role),
  };
  const { workflow, ...jobFields } = job;
  if (!workflow) return { job: jobFields, instance: null, permissions };

  const modules = await loadInstanceModules(prisma, workflow.id);
  const jobToggles = (workflow.scopeToggles ?? {}) as ScopeToggleState;
  const moduleIndex = new Map(modules.map((m, i) => [m.moduleKey, i]));

  const tasks = await prisma.task.findMany({
    where: { AND: [{ workflowInstanceId: workflow.id }, taskVisibilityFilter(user, scope)] },
    include: WORKFLOW_TASK_INCLUDE,
    orderBy: [{ workflowSortOrder: "asc" }, { createdAt: "asc" }],
  });

  // Phase metadata from the pinned versions, in band order.
  type PhaseOut = {
    key: string;
    moduleKey: string;
    moduleName: string;
    shortKey: string;
    name: string;
    band: number;
    note: string | null;
    description: string | null;
    conditionPermit: "REQUIRED" | "NOT_REQUIRED" | null;
    sortOrder: number;
    progress: PhaseProgress;
    taskIds: string[];
  };
  const phases = new Map<string, PhaseOut>();
  for (const m of modules) {
    for (const p of m.definition.phases) {
      phases.set(fullKey(m.moduleKey, p.key), {
        key: fullKey(m.moduleKey, p.key),
        moduleKey: m.moduleKey,
        moduleName: m.name,
        shortKey: p.key,
        name: p.name,
        band: p.band,
        note: p.note,
        description: p.description,
        conditionPermit: p.conditionPermit,
        sortOrder: p.sortOrder,
        progress: emptyProgress(),
        taskIds: [],
      });
    }
  }
  const overall = emptyProgress();
  const openUnassignedRoles = new Set<WorkflowRole>();
  for (const t of tasks) {
    tally(overall, t, now);
    const open = t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED";
    if (open && !t.assignedUserId && t.workflowRole) openUnassignedRoles.add(t.workflowRole);
    const pk = t.workflowPhaseKey ?? "other:other";
    let phase = phases.get(pk);
    if (!phase) {
      const { moduleKey, shortKey } = splitFullKey(pk);
      phase = {
        key: pk,
        moduleKey,
        moduleName: moduleKey === "other" ? "Other" : `Removed: ${moduleKey}`,
        shortKey,
        name: shortKey === "other" ? "Other tasks" : shortKey,
        band: 9999,
        note: null,
        description: null,
        conditionPermit: null,
        sortOrder: 0,
        progress: emptyProgress(),
        taskIds: [],
      };
      phases.set(pk, phase);
    }
    tally(phase.progress, t, now);
    phase.taskIds.push(t.id);
  }
  const phaseList = Array.from(phases.values())
    .filter((p) => p.taskIds.length > 0)
    .sort(
      (a, b) =>
        a.band - b.band ||
        (moduleIndex.get(a.moduleKey) ?? 99) - (moduleIndex.get(b.moduleKey) ?? 99) ||
        a.sortOrder - b.sortOrder,
    );

  const roleCtx = await loadRoleContext(prisma, { jobId: job.id, instanceId: workflow.id });

  return {
    job: jobFields,
    permissions,
    instance: {
      id: workflow.id,
      status: workflow.status,
      permitStatus: workflow.permitStatus,
      permitDeterminedAt: workflow.permitDeterminedAt,
      permitDeterminedBy: workflow.permitDeterminedBy,
      permitNotes: workflow.permitNotes,
      permitDocumentFileId: workflow.permitDocumentFileId,
      scopeToggles: jobToggles,
      appliedAt: workflow.appliedAt,
      appliedBy: workflow.appliedBy,
      lastReconciledAt: workflow.lastReconciledAt,
    },
    modules: workflow.modules.map((m) => ({
      templateKey: m.template.key,
      name: m.template.name,
      kind: m.template.kind,
      trade: m.template.trade,
      version: m.templateVersion.version,
      versionId: m.templateVersion.id,
      removedAt: m.removedAt,
    })),
    team: workflow.team.map((t) => ({ role: t.role, user: t.user })),
    toggles: modules
      .filter((m) => m.definition.scopeToggles.length > 0)
      .map((m) => ({ moduleKey: m.moduleKey, name: m.name, toggles: m.definition.scopeToggles, values: resolveToggles(m, jobToggles) })),
    phases: phaseList,
    tasks,
    progress: overall,
    unassignedRoles: unassignedRoles(openUnassignedRoles, roleCtx),
  };
}

export type JobWorkflowRead = NonNullable<Awaited<ReturnType<typeof readJobWorkflow>>>;
