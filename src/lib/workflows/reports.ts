import type {
  JobWorkflowStatus,
  PermitInspectionResult,
  Prisma,
  TaskStatus,
  WorkflowEvidenceType,
  WorkflowPermitStatus,
  WorkflowRole,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatAddressLine } from "@/lib/labels/address";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { DETERMINE_PERMIT_FULL_KEY, fullKey, splitFullKey } from "./keys";
import { ENGINE_SKIP_PREFIX } from "./reconcile";
import { WORKFLOW_ROLE_LABEL } from "./role-labels";
import { PHASE_BANDS } from "./templates/types";
import { loadJobWorkflowSummaries, type JobWorkflowSummary, type SummaryModule, type SummaryPhase } from "./summary";

/**
 * Workflow reporting, computed in pure functions over a flat projection of
 * the task rows so every number is testable without a database:
 *
 *   - how long steps take, by trade and by phase (and whole-phase cycle time)
 *   - what is overdue, by functional role
 *   - what is stalled and why (`classifyDelayCause`)
 *   - lead times: job → applied, applied → production start, permit cycle
 *   - the steps people skip most
 *
 * Durations are calendar days to one decimal — what the office actually
 * waits — not business days, which is what the schedule engine promises.
 */

export type ReportTask = {
  id: string;
  workflowInstanceId: string | null;
  workflowTaskKey: string | null;
  workflowPhaseKey: string | null;
  workflowModuleKey: string | null;
  workflowRole: WorkflowRole | null;
  title: string;
  status: TaskStatus;
  activatedAt: Date | null;
  completedAt: Date | null;
  dueAt: Date | null;
  assignedUserId: string | null;
  skipReason: string | null;
  inspectionResult: PermitInspectionResult | null;
  requiredEvidence: WorkflowEvidenceType | null;
};

export type ReportInstance = {
  id: string;
  jobId: string;
  jobNumber: string;
  jobTitle: string;
  status: JobWorkflowStatus;
  permitStatus: WorkflowPermitStatus;
  appliedAt: Date;
  jobCreatedAt: Date;
  modules: SummaryModule[];
  phases: Map<string, SummaryPhase>;
};

export type DurationStats = { n: number; avgDays: number | null; medianDays: number | null; p90Days: number | null };

export type DelayCause = "FAILED_INSPECTION" | "PERMIT_UNDETERMINED" | "PERMIT" | "INSPECTION" | "PAYMENT" | "PROCUREMENT" | "UNASSIGNED" | "OTHER";

export const DELAY_CAUSE_LABEL: Record<DelayCause, string> = {
  FAILED_INSPECTION: "Failed inspection",
  PERMIT_UNDETERMINED: "Permit undetermined",
  PERMIT: "Permitting",
  INSPECTION: "Inspection",
  PAYMENT: "Payment",
  PROCUREMENT: "Procurement",
  UNASSIGNED: "Nobody assigned",
  OTHER: "Other",
};

export const DELAY_CAUSES: readonly DelayCause[] = ["FAILED_INSPECTION", "PERMIT_UNDETERMINED", "PERMIT", "INSPECTION", "PAYMENT", "PROCUREMENT", "UNASSIGNED", "OTHER"];

const MS_PER_DAY = 86_400_000;
const isOpen = (s: TaskStatus) => (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(s);

export function daysBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / MS_PER_DAY) * 10) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function durationStats(values: number[]): DurationStats {
  if (values.length === 0) return { n: 0, avgDays: null, medianDays: null, p90Days: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)]!;
  return {
    n: sorted.length,
    avgDays: round1(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    medianDays: round1(median),
    p90Days: round1(p90),
  };
}

/** A completed step's active time, or null when either end is missing. */
function stepDuration(t: ReportTask): number | null {
  if (t.status !== "COMPLETED" || !t.activatedAt || !t.completedAt) return null;
  return Math.max(0, daysBetween(t.activatedAt, t.completedAt));
}

function moduleName(instances: Map<string, ReportInstance>, instanceId: string | null, moduleKey: string): string {
  const inst = instanceId ? instances.get(instanceId) : undefined;
  return inst?.modules.find((m) => m.key === moduleKey)?.name ?? moduleKey;
}

// ── Durations ──────────────────────────────────────────────────────────────

export type TradeDurationRow = { key: string; name: string } & DurationStats;

export function durationsByTrade(tasks: ReportTask[], instances: Map<string, ReportInstance>): TradeDurationRow[] {
  const buckets = new Map<string, { name: string; values: number[] }>();
  for (const t of tasks) {
    if (!t.workflowTaskKey || !t.workflowModuleKey) continue;
    const d = stepDuration(t);
    if (d === null) continue;
    const b = buckets.get(t.workflowModuleKey) ?? { name: moduleName(instances, t.workflowInstanceId, t.workflowModuleKey), values: [] };
    b.values.push(d);
    buckets.set(t.workflowModuleKey, b);
  }
  return Array.from(buckets.entries())
    .map(([key, b]) => ({ key, name: b.name, ...durationStats(b.values) }))
    .sort((a, b) => (a.key === "core" ? -1 : b.key === "core" ? 1 : a.name.localeCompare(b.name)));
}

export type PhaseDurationRow = {
  key: string;
  name: string;
  moduleKey: string;
  band: number;
  /** Per-step active time. */
  steps: DurationStats;
  /** Whole-phase time on jobs where the phase has closed: first activation → last completion. */
  cycle: DurationStats;
};

export function durationsByPhase(tasks: ReportTask[], instances: Map<string, ReportInstance>): PhaseDurationRow[] {
  const steps = new Map<string, number[]>();
  const perJob = new Map<string, { start: Date | null; end: Date | null; open: boolean; completed: number }>();
  for (const t of tasks) {
    if (!t.workflowTaskKey || !t.workflowPhaseKey) continue;
    const d = stepDuration(t);
    if (d !== null) steps.set(t.workflowPhaseKey, [...(steps.get(t.workflowPhaseKey) ?? []), d]);
    const jk = `${t.workflowInstanceId}|${t.workflowPhaseKey}`;
    const j = perJob.get(jk) ?? { start: null, end: null, open: false, completed: 0 };
    if (isOpen(t.status)) j.open = true;
    if (t.activatedAt && (!j.start || t.activatedAt < j.start)) j.start = t.activatedAt;
    if (t.status === "COMPLETED") {
      j.completed++;
      if (t.completedAt && (!j.end || t.completedAt > j.end)) j.end = t.completedAt;
    }
    perJob.set(jk, j);
  }
  const cycles = new Map<string, number[]>();
  for (const [jk, j] of perJob) {
    if (j.open || j.completed === 0 || !j.start || !j.end) continue;
    const phaseKey = jk.slice(jk.indexOf("|") + 1);
    cycles.set(phaseKey, [...(cycles.get(phaseKey) ?? []), Math.max(0, daysBetween(j.start, j.end))]);
  }
  const keys = new Set([...steps.keys(), ...cycles.keys()]);
  const meta = (phaseKey: string) => {
    for (const inst of instances.values()) {
      const p = inst.phases.get(phaseKey);
      if (p) return p;
    }
    return null;
  };
  return Array.from(keys)
    .map((key) => {
      const p = meta(key);
      const { moduleKey, shortKey } = splitFullKey(key);
      return {
        key,
        name: p?.name ?? shortKey,
        moduleKey,
        band: p?.band ?? 9999,
        steps: durationStats(steps.get(key) ?? []),
        cycle: durationStats(cycles.get(key) ?? []),
      };
    })
    .sort((a, b) => a.band - b.band || a.moduleKey.localeCompare(b.moduleKey) || a.name.localeCompare(b.name));
}

// ── Overdue by role ────────────────────────────────────────────────────────

export type OverdueRoleRow = {
  role: WorkflowRole | "NONE";
  label: string;
  count: number;
  unassigned: number;
  avgDaysOverdue: number;
  maxDaysOverdue: number;
};

export function overdueByRole(tasks: ReportTask[], now: Date): OverdueRoleRow[] {
  const buckets = new Map<string, { role: WorkflowRole | "NONE"; days: number[]; unassigned: number }>();
  for (const t of tasks) {
    if (!t.workflowTaskKey || !isOpen(t.status) || !t.activatedAt || !t.dueAt || t.dueAt >= now) continue;
    const role = t.workflowRole ?? "NONE";
    const b = buckets.get(role) ?? { role, days: [], unassigned: 0 };
    b.days.push(daysBetween(t.dueAt, now));
    if (!t.assignedUserId) b.unassigned++;
    buckets.set(role, b);
  }
  return Array.from(buckets.values())
    .map((b) => ({
      role: b.role,
      label: b.role === "NONE" ? "No role" : WORKFLOW_ROLE_LABEL[b.role],
      count: b.days.length,
      unassigned: b.unassigned,
      avgDaysOverdue: round1(b.days.reduce((a, c) => a + c, 0) / b.days.length),
      maxDaysOverdue: round1(Math.max(...b.days)),
    }))
    .sort((a, b) => b.count - a.count || b.maxDaysOverdue - a.maxDaysOverdue);
}

// ── Delay causes ───────────────────────────────────────────────────────────

export type DelayContext = { phaseBand: number | null; permitStatus: WorkflowPermitStatus | null };

/**
 * Why a step is stalled, in priority order. A failed inspection is its own
 * cause; an open "Determine permit requirement" while the job is still
 * UNDETERMINED is the most common one; then the step's own nature (permit /
 * inspection / payment evidence, or the band it sits in); then nobody to do
 * it; then "other".
 */
export function classifyDelayCause(task: Pick<ReportTask, "workflowTaskKey" | "requiredEvidence" | "inspectionResult" | "assignedUserId" | "title">, ctx: DelayContext): DelayCause {
  if (task.inspectionResult === "FAIL") return "FAILED_INSPECTION";
  if (task.workflowTaskKey === DETERMINE_PERMIT_FULL_KEY && ctx.permitStatus === "UNDETERMINED") return "PERMIT_UNDETERMINED";
  const short = task.workflowTaskKey ? splitFullKey(task.workflowTaskKey).shortKey : "";
  if (task.requiredEvidence === "PERMIT_NUMBER" || task.requiredEvidence === "PERMIT_DETERMINATION") return "PERMIT";
  if (task.requiredEvidence === "INSPECTION_RESULT" || /inspection/.test(short)) return "INSPECTION";
  if (ctx.phaseBand === PHASE_BANDS.PERMITTING || /permit/.test(short)) return "PERMIT";
  if (task.requiredEvidence === "PAYMENT_STATUS") return "PAYMENT";
  if (ctx.phaseBand === PHASE_BANDS.PROCUREMENT) return "PROCUREMENT";
  if (!task.assignedUserId) return "UNASSIGNED";
  return "OTHER";
}

export type StalledItem = {
  taskId: string;
  jobId: string;
  jobNumber: string;
  jobTitle: string;
  title: string;
  cause: DelayCause;
  state: "BLOCKED" | "OVERDUE";
  role: WorkflowRole | null;
  daysOverdue: number | null;
  assigned: boolean;
};

export type StalledSummary = {
  byCause: { cause: DelayCause; label: string; blocked: number; overdue: number; jobs: number }[];
  items: StalledItem[];
};

/** Blocked steps plus active steps past due, classified. `items` is the worst first, capped. */
export function stalledSteps(tasks: ReportTask[], instances: Map<string, ReportInstance>, now: Date, limit = 25): StalledSummary {
  const rows = new Map<DelayCause, { blocked: number; overdue: number; jobs: Set<string> }>();
  const items: StalledItem[] = [];
  for (const t of tasks) {
    if (!t.workflowTaskKey || !isOpen(t.status) || !t.activatedAt) continue;
    const overdue = Boolean(t.dueAt && t.dueAt < now);
    const blocked = t.status === "BLOCKED";
    if (!overdue && !blocked) continue;
    const inst = t.workflowInstanceId ? instances.get(t.workflowInstanceId) : undefined;
    if (!inst) continue;
    const phase = t.workflowPhaseKey ? inst.phases.get(t.workflowPhaseKey) : undefined;
    const cause = classifyDelayCause(t, { phaseBand: phase?.band ?? null, permitStatus: inst.permitStatus });
    const r = rows.get(cause) ?? { blocked: 0, overdue: 0, jobs: new Set<string>() };
    if (blocked) r.blocked++;
    else r.overdue++;
    r.jobs.add(inst.jobId);
    rows.set(cause, r);
    items.push({
      taskId: t.id,
      jobId: inst.jobId,
      jobNumber: inst.jobNumber,
      jobTitle: inst.jobTitle,
      title: t.title,
      cause,
      state: blocked ? "BLOCKED" : "OVERDUE",
      role: t.workflowRole,
      daysOverdue: overdue && t.dueAt ? daysBetween(t.dueAt, now) : null,
      assigned: t.assignedUserId !== null,
    });
  }
  items.sort((a, b) => Number(b.state === "BLOCKED") - Number(a.state === "BLOCKED") || (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
  return {
    byCause: DELAY_CAUSES.filter((c) => rows.has(c)).map((c) => {
      const r = rows.get(c)!;
      return { cause: c, label: DELAY_CAUSE_LABEL[c], blocked: r.blocked, overdue: r.overdue, jobs: r.jobs.size };
    }),
    items: items.slice(0, limit),
  };
}

// ── Lead times ─────────────────────────────────────────────────────────────

export type LeadTimeRow = { metric: "createdToApplied" | "appliedToProductionStart" | "permitCycle"; label: string } & DurationStats;
export type LeadTimes = { overall: LeadTimeRow[]; productionStartByTrade: TradeDurationRow[] };

const PRODUCTION_START_KEY = "core:confirm_production_start";
const isPermitIssued = (t: ReportTask) =>
  t.requiredEvidence === "PERMIT_NUMBER" || (t.workflowTaskKey !== null && splitFullKey(t.workflowTaskKey).shortKey === "confirm_permit_issued");

export function leadTimes(tasks: ReportTask[], instances: Map<string, ReportInstance>): LeadTimes {
  const byInstance = new Map<string, ReportTask[]>();
  for (const t of tasks) {
    if (!t.workflowInstanceId || !t.workflowTaskKey) continue;
    byInstance.set(t.workflowInstanceId, [...(byInstance.get(t.workflowInstanceId) ?? []), t]);
  }
  const createdToApplied: number[] = [];
  const toProduction: number[] = [];
  const permit: number[] = [];
  const byTrade = new Map<string, { name: string; values: number[] }>();
  for (const inst of instances.values()) {
    createdToApplied.push(Math.max(0, daysBetween(inst.jobCreatedAt, inst.appliedAt)));
    const mine = byInstance.get(inst.id) ?? [];
    const start = mine.find((t) => t.workflowTaskKey === PRODUCTION_START_KEY && t.status === "COMPLETED" && t.completedAt);
    if (start?.completedAt) {
      const d = Math.max(0, daysBetween(inst.appliedAt, start.completedAt));
      toProduction.push(d);
      for (const m of inst.modules) {
        if (m.kind !== "TRADE") continue;
        const b = byTrade.get(m.key) ?? { name: m.name, values: [] };
        b.values.push(d);
        byTrade.set(m.key, b);
      }
    }
    const determined = mine.find((t) => t.workflowTaskKey === DETERMINE_PERMIT_FULL_KEY && t.status === "COMPLETED" && t.completedAt);
    const issued = mine
      .filter((t) => isPermitIssued(t) && t.status === "COMPLETED" && t.completedAt)
      .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())[0];
    if (determined?.completedAt && issued?.completedAt) permit.push(Math.max(0, daysBetween(determined.completedAt, issued.completedAt)));
  }
  return {
    overall: [
      { metric: "createdToApplied", label: "Job created → workflow applied", ...durationStats(createdToApplied) },
      { metric: "appliedToProductionStart", label: "Applied → production start confirmed", ...durationStats(toProduction) },
      { metric: "permitCycle", label: "Permit decided → permit issued", ...durationStats(permit) },
    ],
    productionStartByTrade: Array.from(byTrade.entries())
      .map(([key, b]) => ({ key, name: b.name, ...durationStats(b.values) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── Skips ──────────────────────────────────────────────────────────────────

export type SkippedStepRow = { key: string; title: string; count: number; userSkips: number; engineSkips: number; lastReason: string | null };

/** Steps skipped by a person first (an engine skip is a re-plan, not a choice), then by total. */
export function mostSkipped(tasks: ReportTask[], limit = 15): SkippedStepRow[] {
  const rows = new Map<string, SkippedStepRow>();
  for (const t of tasks) {
    if (!t.workflowTaskKey || t.status !== "CANCELLED" || !t.skipReason) continue;
    const r = rows.get(t.workflowTaskKey) ?? { key: t.workflowTaskKey, title: t.title, count: 0, userSkips: 0, engineSkips: 0, lastReason: null };
    r.count++;
    if (t.skipReason.startsWith(ENGINE_SKIP_PREFIX)) r.engineSkips++;
    else {
      r.userSkips++;
      r.lastReason = t.skipReason;
    }
    rows.set(t.workflowTaskKey, r);
  }
  return Array.from(rows.values())
    .sort((a, b) => b.userSkips - a.userSkips || b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, limit);
}

// ── Assembly ───────────────────────────────────────────────────────────────

export type WorkflowReport = {
  generatedAt: string;
  range: { from: string | null; to: string | null };
  summary: {
    workflows: number;
    active: number;
    completed: number;
    stepsOpen: number;
    stepsReady: number;
    stepsOverdue: number;
    stepsBlocked: number;
    stepsUnassigned: number;
    failedInspections: number;
    permitsUndetermined: number;
  };
  durationsByTrade: TradeDurationRow[];
  durationsByPhase: PhaseDurationRow[];
  overdueByRole: OverdueRoleRow[];
  stalled: StalledSummary;
  leadTimes: LeadTimes;
  mostSkipped: SkippedStepRow[];
};

export function buildWorkflowReport(
  instances: Map<string, ReportInstance>,
  tasks: ReportTask[],
  now: Date,
  range: { from: Date | null; to: Date | null } = { from: null, to: null },
): WorkflowReport {
  let open = 0;
  let ready = 0;
  let overdue = 0;
  let blocked = 0;
  let unassigned = 0;
  let failed = 0;
  for (const t of tasks) {
    if (!t.workflowTaskKey || !isOpen(t.status)) continue;
    open++;
    if (!t.activatedAt) continue;
    if (t.status === "PENDING") ready++;
    if (t.status === "BLOCKED") blocked++;
    if (t.inspectionResult === "FAIL") failed++;
    if (t.dueAt && t.dueAt < now) overdue++;
    if (!t.assignedUserId) unassigned++;
  }
  const all = Array.from(instances.values());
  return {
    generatedAt: now.toISOString(),
    range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
    summary: {
      workflows: all.length,
      active: all.filter((i) => i.status === "ACTIVE").length,
      completed: all.filter((i) => i.status === "COMPLETED").length,
      stepsOpen: open,
      stepsReady: ready,
      stepsOverdue: overdue,
      stepsBlocked: blocked,
      stepsUnassigned: unassigned,
      failedInspections: failed,
      permitsUndetermined: all.filter((i) => i.status === "ACTIVE" && i.permitStatus === "UNDETERMINED").length,
    },
    durationsByTrade: durationsByTrade(tasks, instances),
    durationsByPhase: durationsByPhase(tasks, instances),
    overdueByRole: overdueByRole(tasks, now),
    stalled: stalledSteps(tasks, instances, now),
    leadTimes: leadTimes(tasks, instances),
    mostSkipped: mostSkipped(tasks),
  };
}

// ── Health (dashboard widget) ──────────────────────────────────────────────

export type WorkflowHealthJob = {
  jobId: string;
  jobNumber: string;
  title: string;
  customer: string | null;
  address: string | null;
  currentPhase: string | null;
  percentComplete: number;
  overdue: number;
  blocked: number;
  unassigned: number;
  permitStatus: WorkflowPermitStatus;
};

export type WorkflowHealth = {
  generatedAt: string;
  active: number;
  stepsReady: number;
  stepsOverdue: number;
  stepsBlocked: number;
  stepsUnassigned: number;
  failedInspections: number;
  permitsUndetermined: number;
  jobsWithIssues: number;
  attention: WorkflowHealthJob[];
};

export function buildWorkflowHealth(
  jobs: { id: string; jobNumber: string; title: string; customer: string | null; address?: string | null }[],
  summaries: Map<string, JobWorkflowSummary>,
  now: Date,
  limit = 5,
): WorkflowHealth {
  const h: WorkflowHealth = {
    generatedAt: now.toISOString(),
    active: 0,
    stepsReady: 0,
    stepsOverdue: 0,
    stepsBlocked: 0,
    stepsUnassigned: 0,
    failedInspections: 0,
    permitsUndetermined: 0,
    jobsWithIssues: 0,
    attention: [],
  };
  const candidates: (WorkflowHealthJob & { score: number })[] = [];
  for (const j of jobs) {
    const s = summaries.get(j.id);
    if (!s || s.status !== "ACTIVE") continue;
    h.active++;
    h.stepsReady += s.ready;
    h.stepsOverdue += s.overdue;
    h.stepsBlocked += s.blocked;
    h.stepsUnassigned += s.unassigned;
    h.failedInspections += s.failedInspections;
    if (s.permitStatus === "UNDETERMINED") h.permitsUndetermined++;
    const score = s.blocked * 3 + s.overdue * 2 + s.unassigned;
    if (score > 0) {
      h.jobsWithIssues++;
      candidates.push({
        jobId: j.id,
        jobNumber: j.jobNumber,
        title: j.title,
        customer: j.customer,
        address: j.address ?? null,
        currentPhase: s.currentPhase?.name ?? null,
        percentComplete: s.percentComplete,
        overdue: s.overdue,
        blocked: s.blocked,
        unassigned: s.unassigned,
        permitStatus: s.permitStatus,
        score,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.jobNumber.localeCompare(b.jobNumber));
  h.attention = candidates.slice(0, limit).map((c) => {
    const { score, ...rest } = c;
    void score;
    return rest;
  });
  return h;
}

// ── Loaders ────────────────────────────────────────────────────────────────

const REPORT_TASK_SELECT = {
  id: true,
  workflowInstanceId: true,
  workflowTaskKey: true,
  workflowPhaseKey: true,
  workflowModuleKey: true,
  workflowRole: true,
  title: true,
  status: true,
  activatedAt: true,
  completedAt: true,
  dueAt: true,
  assignedUserId: true,
  skipReason: true,
  inspectionResult: true,
  requiredEvidence: true,
} satisfies Prisma.TaskSelect;

/** The full report. `range` limits which workflows count, by the date they were applied. */
export async function loadWorkflowReport(range: { from: Date | null; to: Date | null }, now = new Date()): Promise<WorkflowReport> {
  const appliedAt = { ...(range.from && { gte: range.from }), ...(range.to && { lte: range.to }) };
  // Job workflows only: violation cases have their own report.
  const rows = await prisma.jobWorkflowInstance.findMany({
    where: { jobId: { not: null }, ...(Object.keys(appliedAt).length > 0 ? { appliedAt } : {}) },
    select: {
      id: true,
      jobId: true,
      status: true,
      permitStatus: true,
      appliedAt: true,
      job: { select: { jobNumber: true, title: true, createdAt: true } },
      modules: {
        where: { removedAt: null },
        orderBy: { addedAt: "asc" },
        select: { templateKey: true, templateVersionId: true, template: { select: { name: true, kind: true, trade: true } } },
      },
    },
  });
  const instances = new Map<string, ReportInstance>();
  if (rows.length === 0) return buildWorkflowReport(instances, [], now, range);

  const versionIds = Array.from(new Set(rows.flatMap((r) => r.modules.map((m) => m.templateVersionId))));
  const [phaseRows, tasks] = await Promise.all([
    prisma.workflowPhase.findMany({ where: { versionId: { in: versionIds } }, select: { versionId: true, key: true, name: true, band: true, sortOrder: true } }),
    prisma.task.findMany({ where: { workflowInstanceId: { in: rows.map((r) => r.id) }, workflowTaskKey: { not: null } }, select: REPORT_TASK_SELECT }),
  ]);
  for (const r of rows) {
    if (!r.jobId || !r.job) continue;
    const phases = new Map<string, SummaryPhase>();
    for (const m of r.modules) {
      for (const p of phaseRows) {
        if (p.versionId !== m.templateVersionId) continue;
        const key = fullKey(m.templateKey, p.key);
        phases.set(key, { key, name: p.name, band: p.band, sortOrder: p.sortOrder });
      }
    }
    instances.set(r.id, {
      id: r.id,
      jobId: r.jobId,
      jobNumber: r.job.jobNumber,
      jobTitle: r.job.title,
      status: r.status,
      permitStatus: r.permitStatus,
      appliedAt: r.appliedAt,
      jobCreatedAt: r.job.createdAt,
      modules: r.modules.map((m, index) => ({ key: m.templateKey, name: m.template.name, kind: m.template.kind, trade: m.template.trade, index })),
      phases,
    });
  }
  return buildWorkflowReport(instances, tasks, now, range);
}

/** The dashboard snapshot over the jobs `jobWhere` allows (role scoping lives in the route). */
export async function loadWorkflowHealth(jobWhere: Prisma.JobWhereInput, now = new Date()): Promise<WorkflowHealth> {
  const jobs = await prisma.job.findMany({
    where: { ...jobWhere, workflow: { status: "ACTIVE" } },
    select: JOB_LABEL_SELECT,
    orderBy: { createdAt: "desc" },
  });
  const summaries = await loadJobWorkflowSummaries(jobs.map((j) => j.id), now);
  return buildWorkflowHealth(
    jobs.map((j) => ({ id: j.id, jobNumber: j.jobNumber, title: j.title, customer: j.lead.fullName, address: formatAddressLine(j.lead) || null })),
    summaries,
    now,
  );
}
