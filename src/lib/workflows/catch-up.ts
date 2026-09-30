import type { RoleName, TaskStatus, WorkflowEvidenceType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { recordTaskEvent } from "@/lib/tasks/events";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { TaskUpdateError, updateTask } from "@/lib/tasks/update";
import { maybeCompleteInstance, sweepActivation } from "./activation";
import { isSatisfied, topoSort } from "./dependencies";
import { checkEvidence, readChecklist } from "./evidence";
import { completeSatisfiedGates } from "./gates";
import { loadInstanceModules } from "./load";
import { isLegacyStep, pinnedSteps } from "./plan-membership";
import { loadSubjectForInstance } from "./subject";

/**
 * "Complete this phase" — catching a workflow up with work that was done
 * away from the CRM.
 *
 * The office finishes setup on the phone and the job is on site before
 * anybody opens the Workflow tab; without this, the only way to bring the
 * tab back in line was one step at a time. The rules that keep it honest:
 *
 *  - only the open steps of ONE phase, completed in dependency order;
 *  - a step whose blocking predecessor lies outside the selection and is
 *    still open is held — a phase is not finished around its gate;
 *  - a record gate is completed through the ordinary `updateTask` path, so
 *    the deposit, the permit number and the rest must really be on file;
 *    what is missing is reported, never bypassed;
 *  - an inspection step needs its result recorded on the step, and "Close
 *    case" is never caught up;
 *  - blocking steps are offered unticked: a gate is completed because a
 *    person said so, not because it sat in the phase.
 *
 * `planCatchUp` is pure; `runCatchUp` loads, plans and (unless `dryRun`)
 * applies, quietly, then wakes what became ready once.
 */

const CORRECTION_MARK = ":correction:";
const isOpen = (s: TaskStatus) => (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(s);

export type CatchUpRow = {
  id: string;
  key: string | null;
  title: string;
  status: TaskStatus;
  phaseKey: string | null;
  blocking: boolean;
  requiredEvidence: WorkflowEvidenceType | null;
  sortOrder: number | null;
};

export type CatchUpEdge = { taskId: string; dependsOnTaskId: string; kind: "BLOCKING" | "DATE_ONLY" };

export type CatchUpStep = {
  id: string;
  title: string;
  blocking: boolean;
  gate: WorkflowEvidenceType | null;
  selected: boolean;
  /** "ok" will be completed; "held" cannot be, and says why; "unselected" was left out by the person. */
  state: "ok" | "held" | "unselected";
  reason: string | null;
};

/**
 * Pure. `selected` = the step ids the person ticked; omit it for the default
 * (every step that is not a blocking gate).
 */
export function planCatchUp(rows: CatchUpRow[], edges: CatchUpEdge[], phaseKey: string, selected?: ReadonlySet<string>): CatchUpStep[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates = rows
    .filter((r) => r.phaseKey === phaseKey && r.key !== null && !r.key.includes(CORRECTION_MARK) && isOpen(r.status))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const ids = candidates.map((c) => c.id);
  const inPhase = new Set(ids);
  const blocking = edges.filter((e) => e.kind === "BLOCKING");
  const ordered = topoSort(
    ids,
    blocking.filter((e) => inPhase.has(e.taskId) && inPhase.has(e.dependsOnTaskId)).map((e) => ({ task: e.taskId, dependsOn: e.dependsOnTaskId, kind: e.kind })),
  );

  const result = new Map<string, CatchUpStep>();
  for (const id of ordered) {
    const r = byId.get(id)!;
    const isSelected = selected ? selected.has(id) : !r.blocking;
    const step: CatchUpStep = { id, title: r.title, blocking: r.blocking, gate: r.requiredEvidence, selected: isSelected, state: "ok", reason: null };
    const hold = (reason: string) => Object.assign(step, { state: "held" as const, reason });

    if (r.key!.endsWith(":close_case")) hold("Close the case from its own step — it is never caught up");
    else if (r.requiredEvidence === "INSPECTION_RESULT") hold("Record the inspection result on the step");
    else if (!isSelected) step.state = "unselected";

    if (step.state === "ok") {
      // Every blocking predecessor must be closed already, or be completed earlier in this same run.
      const waiting = blocking
        .filter((e) => e.taskId === id)
        .map((e) => byId.get(e.dependsOnTaskId))
        .filter((p): p is CatchUpRow => Boolean(p) && !isSatisfied(p!.status) && result.get(p!.id)?.state !== "ok");
      if (waiting.length > 0) hold(`Waits on: ${waiting.map((p) => p.title).join(", ")}`);
    }
    result.set(id, step);
  }
  return ordered.map((id) => result.get(id)!);
}

export class CatchUpError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "CatchUpError";
  }
}

export type CatchUpResult = {
  phaseKey: string;
  phaseName: string;
  steps: CatchUpStep[];
  /** Set when it was applied. */
  completed?: number;
  activated?: number;
};

const ROW_SELECT = {
  id: true,
  workflowTaskKey: true,
  title: true,
  status: true,
  workflowPhaseKey: true,
  blocking: true,
  requiredEvidence: true,
  requiredEvidenceParam: true,
  workflowSortOrder: true,
  checklist: true,
  jobId: true,
  violationCaseId: true,
  workflowInstanceId: true,
  inspectionResult: true,
} as const;

export async function runCatchUp(args: {
  instanceId: string;
  phaseKey: string;
  taskIds?: string[];
  dryRun?: boolean;
  actor: { id: string; role: RoleName };
}): Promise<CatchUpResult> {
  const subject = await loadSubjectForInstance(prisma, args.instanceId);
  if (!subject?.instance) throw new CatchUpError(404, "Workflow not found");
  const modules = await loadInstanceModules(prisma, args.instanceId);
  const phase = modules.flatMap((m) => m.definition.phases.map((p) => ({ key: `${m.moduleKey}:${p.key}`, name: p.name }))).find((p) => p.key === args.phaseKey);
  if (!phase) throw new CatchUpError(400, "That phase is not part of this workflow");

  const pinned = pinnedSteps(modules);
  const all = await prisma.task.findMany({ where: { workflowInstanceId: args.instanceId }, select: ROW_SELECT });
  // Steps of an earlier template version are history; they are not caught up.
  const live = all.filter((t) => !isLegacyStep(t.workflowTaskKey, pinned));
  const rows: CatchUpRow[] = live.map((t) => ({
    id: t.id,
    key: t.workflowTaskKey,
    title: t.title,
    status: t.status,
    phaseKey: t.workflowPhaseKey,
    blocking: t.blocking,
    requiredEvidence: t.requiredEvidence,
    sortOrder: t.workflowSortOrder,
  }));
  const edges = (await prisma.taskDependency.findMany({
    where: { taskId: { in: live.map((t) => t.id) } },
    select: { taskId: true, dependsOnTaskId: true, kind: true },
  })) as CatchUpEdge[];

  const steps = planCatchUp(rows, edges, args.phaseKey, args.taskIds ? new Set(args.taskIds) : undefined);
  const byId = new Map(live.map((t) => [t.id, t]));
  const ticked = (raw: unknown) => readChecklist(raw as never).map((c) => ({ key: c.key, done: true }));

  // A record gate is checked with its checklist assumed ticked: that is what the run will send.
  const hold = (s: CatchUpStep, reason: string) => Object.assign(s, { state: "held" as const, reason });
  const recheck = (after: number) => {
    // A step that waited on one just held is held too.
    for (let i = after + 1; i < steps.length; i += 1) {
      const s = steps[i]!;
      if (s.state !== "ok") continue;
      const waiting = edges
        .filter((e) => e.kind === "BLOCKING" && e.taskId === s.id)
        .map((e) => steps.find((x) => x.id === e.dependsOnTaskId))
        .filter((p): p is CatchUpStep => Boolean(p) && p!.state !== "ok");
      if (waiting.length > 0) hold(s, `Waits on: ${waiting.map((p) => p.title).join(", ")}`);
    }
  };
  for (const [i, s] of steps.entries()) {
    if (s.state !== "ok" || !s.gate) continue;
    const t = byId.get(s.id)!;
    const check = await checkEvidence({ ...t, checklist: readChecklist(t.checklist).map((c) => ({ ...c, done: true })) as never });
    if (!check.ok) {
      hold(s, check.message);
      recheck(i);
    }
  }

  if (args.dryRun) return { phaseKey: phase.key, phaseName: phase.name, steps };

  let completed = 0;
  for (const [i, s] of steps.entries()) {
    if (s.state !== "ok") continue;
    const t = byId.get(s.id)!;
    try {
      await updateTask({
        id: s.id,
        input: { status: "COMPLETED", checklist: ticked(t.checklist) },
        actorUserId: args.actor.id,
        actorRole: args.actor.role,
        notify: "none",
        // One sweep at the end wakes what is ready; without this every step would notify the next.
        internal: { quiet: true },
      });
      await recordTaskEvent({ taskId: s.id, actorUserId: args.actor.id, type: "RECONCILED", body: `completed with the phase — ${phase.name} caught up` });
      completed += 1;
    } catch (err) {
      if (!(err instanceof TaskUpdateError)) throw err;
      hold(s, err.message);
      recheck(i);
    }
  }

  let activated = 0;
  if (completed > 0) {
    activated = (await sweepActivation(args.instanceId, args.actor.id)).length;
    await completeSatisfiedGates(args.instanceId, args.actor.id);
    const done = await maybeCompleteInstance(args.instanceId);
    if (done.completed && subject.kind === "job") {
      // The same bridge a single completion crosses: a corrective job's workflow finishing lets its cases proceed.
      const { onJobCompleted } = await import("@/lib/violations/job-sync");
      await onJobCompleted(subject.id, args.actor.id, "workflow");
    }
    await prisma.activityLog.create({
      data: {
        leadId: subject.leadId,
        activityType: "TASK_COMPLETED",
        title: `Workflow phase caught up: ${phase.name} — ${completed} step${completed === 1 ? "" : "s"} completed`,
        createdByUserId: args.actor.id,
      },
    });
    await recordAudit({
      actorUserId: args.actor.id,
      entityType: "JobWorkflowInstance",
      entityId: args.instanceId,
      action: "workflow_catch_up",
      after: { phaseKey: phase.key, completed, held: steps.filter((s) => s.state === "held").map((s) => ({ id: s.id, reason: s.reason })), activated },
    });
  }

  return { phaseKey: phase.key, phaseName: phase.name, steps, completed, activated };
}
