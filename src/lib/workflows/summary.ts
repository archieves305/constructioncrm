import type { JobWorkflowStatus, PermitInspectionResult, TaskStatus, WorkflowPermitStatus, WorkflowTemplateKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { fullKey, splitFullKey } from "./keys";

/**
 * One line per job about its workflow — what the jobs list, the production
 * board and the dashboard widget show. Computed from the ordinary task rows
 * (there is no separate progress table), in a pure function over a small
 * projection so it can be tested without a database.
 */

export type SummaryTask = {
  status: TaskStatus;
  activatedAt: Date | null;
  dueAt: Date | null;
  assignedUserId: string | null;
  workflowPhaseKey: string | null;
  workflowTaskKey: string | null;
  inspectionResult: PermitInspectionResult | null;
};

export type SummaryPhase = {
  /** Full key, "<module>:<phase>". */
  key: string;
  name: string;
  band: number;
  sortOrder: number;
};

export type SummaryModule = {
  key: string;
  name: string;
  kind: WorkflowTemplateKind;
  trade: string | null;
  /** Order applied; breaks band ties the same way the Workflow tab does. */
  index: number;
};

export type SummaryInstance = {
  id: string;
  jobId: string;
  status: JobWorkflowStatus;
  permitStatus: WorkflowPermitStatus;
  appliedAt: Date;
  modules: SummaryModule[];
};

export type JobWorkflowSummary = {
  instanceId: string;
  status: JobWorkflowStatus;
  permitStatus: WorkflowPermitStatus;
  /** Trade modules only (Core is implied). */
  trades: { key: string; name: string; trade: string | null }[];
  /** The lowest-band phase with active open work; falls back to waiting work; null when nothing is open. */
  currentPhase: { key: string; name: string; moduleKey: string; band: number } | null;
  total: number;
  done: number;
  skipped: number;
  open: number;
  ready: number;
  blocked: number;
  failedInspections: number;
  overdue: number;
  unassigned: number;
  /** done ÷ (total − skipped), 0–100. */
  percentComplete: number;
};

const isOpen = (s: TaskStatus) => (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(s);

/**
 * Summarise one instance. `counts` carries the closed tallies (from a
 * groupBy) so callers need not load every completed row; `openTasks` is the
 * open rows for the instance.
 */
export function summarizeInstance(
  instance: SummaryInstance,
  openTasks: SummaryTask[],
  counts: { total: number; done: number; skipped: number },
  phases: Map<string, SummaryPhase>,
  now: Date,
): JobWorkflowSummary {
  const moduleIndex = new Map(instance.modules.map((m) => [m.key, m.index]));
  let ready = 0;
  let blocked = 0;
  let failed = 0;
  let overdue = 0;
  let unassigned = 0;
  let activePhase: (SummaryPhase & { moduleKey: string }) | null = null;
  let waitingPhase: (SummaryPhase & { moduleKey: string }) | null = null;

  const earlier = (a: SummaryPhase & { moduleKey: string }, b: SummaryPhase & { moduleKey: string } | null) => {
    if (!b) return true;
    return (
      a.band - b.band ||
      (moduleIndex.get(a.moduleKey) ?? 99) - (moduleIndex.get(b.moduleKey) ?? 99) ||
      a.sortOrder - b.sortOrder
    ) < 0;
  };

  for (const t of openTasks) {
    if (!isOpen(t.status)) continue;
    const step = t.workflowTaskKey !== null;
    const active = t.activatedAt !== null;
    if (step) {
      if (t.status === "BLOCKED") {
        blocked++;
        if (t.inspectionResult === "FAIL") failed++;
      } else if (t.status === "PENDING" && active) ready++;
      if (active && t.dueAt && t.dueAt < now) overdue++;
      if (active && !t.assignedUserId) unassigned++;
    }
    if (t.workflowPhaseKey) {
      const phase = phases.get(t.workflowPhaseKey);
      const { moduleKey, shortKey } = splitFullKey(t.workflowPhaseKey);
      const p = phase
        ? { ...phase, moduleKey }
        : { key: t.workflowPhaseKey, name: shortKey, band: 9999, sortOrder: 0, moduleKey };
      if (active) {
        if (earlier(p, activePhase)) activePhase = p;
      } else if (earlier(p, waitingPhase)) waitingPhase = p;
    }
  }

  const current = activePhase ?? waitingPhase;
  const denominator = counts.total - counts.skipped;
  return {
    instanceId: instance.id,
    status: instance.status,
    permitStatus: instance.permitStatus,
    trades: instance.modules.filter((m) => m.kind === "TRADE").map((m) => ({ key: m.key, name: m.name, trade: m.trade })),
    currentPhase: current ? { key: current.key, name: current.name, moduleKey: current.moduleKey, band: current.band } : null,
    total: counts.total,
    done: counts.done,
    skipped: counts.skipped,
    open: counts.total - counts.done - counts.skipped,
    ready,
    blocked,
    failedInspections: failed,
    overdue,
    unassigned,
    percentComplete: denominator > 0 ? Math.round((counts.done / denominator) * 100) : 0,
  };
}

/**
 * Summaries for a page of jobs, keyed by job id. Three queries whatever the
 * page size: instances with modules, open step rows, and a status groupBy for
 * the closed tallies. Jobs without a workflow are simply absent.
 */
export async function loadJobWorkflowSummaries(jobIds: string[], now = new Date()): Promise<Map<string, JobWorkflowSummary>> {
  const out = new Map<string, JobWorkflowSummary>();
  if (jobIds.length === 0) return out;

  const instances = await prisma.jobWorkflowInstance.findMany({
    where: { jobId: { in: jobIds } },
    select: {
      id: true,
      jobId: true,
      status: true,
      permitStatus: true,
      appliedAt: true,
      modules: {
        where: { removedAt: null },
        orderBy: { addedAt: "asc" },
        select: { templateKey: true, templateVersionId: true, template: { select: { name: true, kind: true, trade: true } } },
      },
    },
  });
  if (instances.length === 0) return out;

  const instanceIds = instances.map((i) => i.id);
  const versionIds = Array.from(new Set(instances.flatMap((i) => i.modules.map((m) => m.templateVersionId))));
  const [openTasks, grouped, phaseRows] = await Promise.all([
    prisma.task.findMany({
      where: { workflowInstanceId: { in: instanceIds }, status: { in: [...OPEN_TASK_STATUSES] } },
      select: {
        workflowInstanceId: true,
        status: true,
        activatedAt: true,
        dueAt: true,
        assignedUserId: true,
        workflowPhaseKey: true,
        workflowTaskKey: true,
        inspectionResult: true,
      },
    }),
    prisma.task.groupBy({
      by: ["workflowInstanceId", "status"],
      where: { workflowInstanceId: { in: instanceIds }, workflowTaskKey: { not: null } },
      _count: { _all: true },
    }),
    prisma.workflowPhase.findMany({
      where: { versionId: { in: versionIds } },
      select: { versionId: true, key: true, name: true, band: true, sortOrder: true },
    }),
  ]);

  const tasksByInstance = new Map<string, SummaryTask[]>();
  for (const t of openTasks) {
    if (!t.workflowInstanceId) continue;
    const list = tasksByInstance.get(t.workflowInstanceId) ?? [];
    list.push(t);
    tasksByInstance.set(t.workflowInstanceId, list);
  }
  const countsByInstance = new Map<string, { total: number; done: number; skipped: number }>();
  for (const g of grouped) {
    if (!g.workflowInstanceId) continue;
    const c = countsByInstance.get(g.workflowInstanceId) ?? { total: 0, done: 0, skipped: 0 };
    c.total += g._count._all;
    if (g.status === "COMPLETED") c.done += g._count._all;
    if (g.status === "CANCELLED") c.skipped += g._count._all;
    countsByInstance.set(g.workflowInstanceId, c);
  }

  for (const inst of instances) {
    const phases = new Map<string, SummaryPhase>();
    for (const m of inst.modules) {
      for (const p of phaseRows) {
        if (p.versionId !== m.templateVersionId) continue;
        const key = fullKey(m.templateKey, p.key);
        phases.set(key, { key, name: p.name, band: p.band, sortOrder: p.sortOrder });
      }
    }
    const summary = summarizeInstance(
      {
        id: inst.id,
        jobId: inst.jobId,
        status: inst.status,
        permitStatus: inst.permitStatus,
        appliedAt: inst.appliedAt,
        modules: inst.modules.map((m, index) => ({ key: m.templateKey, name: m.template.name, kind: m.template.kind, trade: m.template.trade, index })),
      },
      tasksByInstance.get(inst.id) ?? [],
      countsByInstance.get(inst.id) ?? { total: 0, done: 0, skipped: 0 },
      phases,
      now,
    );
    out.set(inst.jobId, summary);
  }
  return out;
}
