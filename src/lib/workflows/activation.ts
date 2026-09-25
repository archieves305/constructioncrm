import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordTaskEvents, type PendingEvent } from "@/lib/tasks/events";
import { isReady, isSatisfied } from "./dependencies";
import { activationDueAt, type ScheduleContext } from "./schedule";
import { notifyTasksReady } from "./notify";
import { ACTIVE_OPEN_WHERE } from "./state";
import { loadSubjectForInstance, scheduleContextFor } from "./subject";

/** Correction tasks carry this in their key (see inspections.ts; duplicated to avoid an import cycle). */
const CORRECTION_MARK = ":correction:";

/**
 * Activation: a step becomes Ready when every BLOCKING predecessor is done
 * or skipped. Runs inline from `updateTask` via `onTaskTransition`, so the
 * next person's task appears the moment the previous one closes.
 *
 * Deliberately NOT through `updateTask`: activation is the engine moving a
 * step into someone's queue, not a person editing it, and routing it through
 * the user edit path would create an import cycle. Events are still written
 * so the timeline explains why the date appeared.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function loadScheduleContext(db: Db, instanceId: string): Promise<ScheduleContext | null> {
  const subject = await loadSubjectForInstance(db, instanceId);
  if (!subject?.instance) return null;
  return scheduleContextFor(subject, subject.instance.appliedAt);
}

const ACTIVATABLE_SELECT = {
  id: true,
  status: true,
  dueAt: true,
  dueLocked: true,
  activatedAt: true,
  workflowAnchor: true,
  dueOffsetBusinessDays: true,
  assignedUserId: true,
  inspectionResult: true,
} as const;

type Activatable = Prisma.TaskGetPayload<{ select: typeof ACTIVATABLE_SELECT }>;

/**
 * Set activatedAt (and a due date unless one is locked or already set by a
 * date anchor) on the given tasks. Returns the ids actually activated.
 */
export async function activateTasks(
  db: Db,
  tasks: Activatable[],
  opts: { reason: "initial" | "dependencies" | "out_of_order" | "reconcile"; actorUserId: string | null; ctx: ScheduleContext; now?: Date },
): Promise<string[]> {
  const now = opts.now ?? new Date();
  const done: string[] = [];
  for (const t of tasks) {
    if (t.activatedAt) continue;
    const step = { anchor: t.workflowAnchor ?? "PREDECESSOR", dueOffsetBusinessDays: t.dueOffsetBusinessDays ?? 0 };
    const keepDate = t.dueLocked || (t.dueAt !== null && step.anchor !== "PREDECESSOR" && step.anchor !== "PHASE_START");
    const dueAt = keepDate ? t.dueAt : activationDueAt(step, now, opts.ctx);
    await db.task.update({ where: { id: t.id }, data: { activatedAt: now, dueAt } });
    const events: PendingEvent[] = [{ type: "ACTIVATED", fromValue: null, toValue: opts.reason }];
    if ((t.dueAt?.getTime() ?? null) !== (dueAt?.getTime() ?? null)) {
      events.push({ type: "DUE_CHANGED", fromValue: t.dueAt?.toISOString() ?? null, toValue: dueAt?.toISOString() ?? null });
    }
    await recordTaskEvents({ taskId: t.id, actorUserId: opts.actorUserId, events });
    done.push(t.id);
  }
  return done;
}

/**
 * A task closed (COMPLETED or CANCELLED). Activate any dependent whose
 * blocking predecessors are now all satisfied; refresh DATE_ONLY dependents
 * that count from this one. Reopening never un-activates — work that has
 * already started is not pulled back out of someone's hands.
 */
export async function onTaskClosed(input: { taskId: string; actorUserId: string | null; now?: Date }): Promise<{ activated: string[] }> {
  const now = input.now ?? new Date();
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      status: true,
      workflowInstanceId: true,
      dependents: { select: { kind: true, task: { select: ACTIVATABLE_SELECT } } },
    },
  });
  if (!task || !task.workflowInstanceId || !isSatisfied(task.status)) return { activated: [] };
  if (task.dependents.length === 0) {
    await maybeCompleteInstance(task.workflowInstanceId);
    return { activated: [] };
  }

  const ctx = await loadScheduleContext(prisma, task.workflowInstanceId);
  if (!ctx) return { activated: [] };

  const toActivate: Activatable[] = [];
  const reopened: string[] = [];
  for (const dep of task.dependents) {
    const d = dep.task;
    if (d.status === "COMPLETED" || d.status === "CANCELLED") continue;
    // A failed inspection waits on its correction task. When that closes,
    // the inspection goes back to Ready with a fresh date — same row, so the
    // FAIL stays on its timeline and the re-request reads as one history.
    if (d.status === "BLOCKED" && d.inspectionResult === "FAIL" && dep.kind === "BLOCKING") {
      // The inspection was already active when it failed, so only its
      // correction tasks gate the re-request — not its ordinary predecessors.
      const preds = await prisma.taskDependency.findMany({
        where: { taskId: d.id, dependsOn: { workflowTaskKey: { contains: CORRECTION_MARK } } },
        select: { kind: true, dependsOn: { select: { status: true } } },
      });
      if (!isReady(preds.map((p) => ({ kind: p.kind, status: p.dependsOn.status })))) continue;
      const dueAt = d.dueLocked ? d.dueAt : activationDueAt({ anchor: "PREDECESSOR", dueOffsetBusinessDays: d.dueOffsetBusinessDays ?? 2 }, now, ctx);
      await prisma.task.update({
        where: { id: d.id },
        data: { status: "PENDING", blockedReason: null, inspectionResult: null, dueAt, escalationLevel: 0, lastEscalatedAt: null },
      });
      await recordTaskEvents({
        taskId: d.id,
        actorUserId: input.actorUserId,
        events: [
          { type: "UNBLOCKED", fromValue: "Failed inspection — corrections done", toValue: "PENDING" },
          ...(dueAt && dueAt.getTime() !== (d.dueAt?.getTime() ?? -1)
            ? [{ type: "DUE_CHANGED" as const, fromValue: d.dueAt?.toISOString() ?? null, toValue: dueAt.toISOString() }]
            : []),
        ],
      });
      reopened.push(d.id);
      continue;
    }
    if (d.activatedAt) {
      // Already someone's work; a DATE_ONLY predecessor closing just refreshes its date.
      if (dep.kind === "DATE_ONLY" && !d.dueLocked && (d.workflowAnchor ?? "PREDECESSOR") === "PREDECESSOR") {
        const dueAt = activationDueAt({ anchor: "PREDECESSOR", dueOffsetBusinessDays: d.dueOffsetBusinessDays ?? 0 }, now, ctx);
        if (dueAt.getTime() !== (d.dueAt?.getTime() ?? -1)) {
          await prisma.task.update({ where: { id: d.id }, data: { dueAt } });
          await recordTaskEvents({
            taskId: d.id,
            actorUserId: input.actorUserId,
            events: [{ type: "DUE_CHANGED", fromValue: d.dueAt?.toISOString() ?? null, toValue: dueAt.toISOString() }],
          });
        }
      }
      continue;
    }
    const preds = await prisma.taskDependency.findMany({
      where: { taskId: d.id },
      select: { kind: true, dependsOn: { select: { status: true } } },
    });
    if (isReady(preds.map((p) => ({ kind: p.kind, status: p.dependsOn.status })))) toActivate.push(d);
  }

  const activated = await activateTasks(prisma, toActivate, { reason: "dependencies", actorUserId: input.actorUserId, ctx, now });
  notifyTasksReady(
    [...toActivate.filter((t) => activated.includes(t.id) && t.assignedUserId).map((t) => t.id), ...reopened],
    input.actorUserId,
  );
  await maybeCompleteInstance(task.workflowInstanceId);
  return { activated: [...activated, ...reopened] };
}

/**
 * Activate every Not-active step in an instance whose blocking predecessors
 * are already satisfied. Used after the graph changes shape (permit decided,
 * trade added) — a plain "wake up whatever is ready now".
 */
export async function sweepActivation(instanceId: string, actorUserId: string | null, now: Date = new Date()): Promise<string[]> {
  const ctx = await loadScheduleContext(prisma, instanceId);
  if (!ctx) return [];
  const waiting = await prisma.task.findMany({
    where: { workflowInstanceId: instanceId, activatedAt: null, status: "PENDING" },
    select: { ...ACTIVATABLE_SELECT, dependencies: { select: { kind: true, dependsOn: { select: { status: true } } } } },
  });
  const ready = waiting.filter((t) => isReady(t.dependencies.map((d) => ({ kind: d.kind, status: d.dependsOn.status }))));
  const activated = await activateTasks(prisma, ready, { reason: "dependencies", actorUserId, ctx, now });
  notifyTasksReady(ready.filter((t) => activated.includes(t.id) && t.assignedUserId).map((t) => t.id), actorUserId);
  return activated;
}

/**
 * Every step closed → the workflow is complete. Reopening a step reactivates
 * it. Returns whether THIS call flipped the instance to COMPLETED, so a
 * caller can react once (a linked violation case stamps its corrective work
 * complete on that edge).
 */
export async function maybeCompleteInstance(instanceId: string): Promise<{ completed: boolean }> {
  const open = await prisma.task.count({ where: { workflowInstanceId: instanceId, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } } });
  const r = await prisma.jobWorkflowInstance.updateMany({
    where: { id: instanceId, status: open === 0 ? "ACTIVE" : "COMPLETED" },
    data: { status: open === 0 ? "COMPLETED" : "ACTIVE" },
  });
  return { completed: open === 0 && (r?.count ?? 0) > 0 };
}

/** Where-fragment for "ready right now" — exported for the tab's count chips. */
export const READY_WHERE = { ...ACTIVE_OPEN_WHERE, status: "PENDING" } satisfies Prisma.TaskWhereInput;
