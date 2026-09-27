import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import type { Priority, TaskEventType, TaskStatus } from "@/generated/prisma/client";

/**
 * The task timeline: who did what, when.
 *
 * The differ is pure and separate from the writer so the interesting part —
 * what counts as a change worth recording — is testable without a database.
 */

export type TaskSnapshot = {
  status: TaskStatus;
  priority: Priority;
  dueAt: Date | null;
  assignedUserId: string | null;
  blockedReason: string | null;
  /**
   * The calendar window. Optional so the many callers that only know the
   * five classic fields keep compiling; a differ that sees it on both sides
   * records SCHEDULE_CHANGED when the start or the all-day flag moved.
   */
  scheduledStart?: Date | null;
  allDay?: boolean;
};

export type PendingEvent = {
  type: TaskEventType;
  fromValue: string | null;
  toValue: string | null;
};

function sameDate(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** `{start, end, allDay}` — what the timeline needs to say "9:00–11:30 → 1:00–3:30". */
export function windowJson(s: TaskSnapshot): string {
  return JSON.stringify({
    start: isoOrNull(s.scheduledStart ?? null),
    end: isoOrNull(s.dueAt),
    allDay: s.allDay ?? true,
  });
}

/**
 * Turn a before/after pair into timeline rows — at most one per field, so a
 * single save never produces a wall of near-identical entries.
 *
 * Entering and leaving BLOCKED get their own types rather than a generic
 * STATUS_CHANGED: "blocked on materials" is the entry people scan the history
 * for, and burying it in a status string makes it invisible.
 */
export function diffTask(before: TaskSnapshot, after: TaskSnapshot): PendingEvent[] {
  const events: PendingEvent[] = [];

  if (before.assignedUserId !== after.assignedUserId) {
    events.push(
      after.assignedUserId
        ? {
            type: "ASSIGNED",
            fromValue: before.assignedUserId,
            toValue: after.assignedUserId,
          }
        : { type: "UNASSIGNED", fromValue: before.assignedUserId, toValue: null },
    );
  }

  if (before.status !== after.status) {
    if (after.status === "BLOCKED") {
      events.push({
        type: "BLOCKED",
        fromValue: before.status,
        toValue: after.blockedReason,
      });
    } else if (before.status === "BLOCKED") {
      events.push({ type: "UNBLOCKED", fromValue: before.blockedReason, toValue: after.status });
    } else {
      events.push({ type: "STATUS_CHANGED", fromValue: before.status, toValue: after.status });
    }
  } else if (
    after.status === "BLOCKED" &&
    (before.blockedReason ?? "") !== (after.blockedReason ?? "")
  ) {
    // Still blocked, but for a different reason — worth its own row.
    events.push({
      type: "BLOCKED",
      fromValue: before.blockedReason,
      toValue: after.blockedReason,
    });
  }

  if (before.priority !== after.priority) {
    events.push({
      type: "PRIORITY_CHANGED",
      fromValue: before.priority,
      toValue: after.priority,
    });
  }

  if (!sameDate(before.dueAt, after.dueAt)) {
    events.push({
      type: "DUE_CHANGED",
      fromValue: isoOrNull(before.dueAt),
      toValue: isoOrNull(after.dueAt),
    });
  }

  // The window (start / all-day) is its own fact: "moved to Tuesday" and
  // "now 9:00–11:30" are different things to read in the history. A plain
  // day move of an all-day task changes neither, so it stays DUE_CHANGED only.
  const knowsWindow = before.scheduledStart !== undefined && after.scheduledStart !== undefined;
  if (knowsWindow) {
    const startMoved = !sameDate(before.scheduledStart ?? null, after.scheduledStart ?? null);
    const flagMoved = (before.allDay ?? true) !== (after.allDay ?? true);
    if (startMoved || flagMoved) {
      events.push({
        type: "SCHEDULE_CHANGED",
        fromValue: windowJson(before),
        toValue: windowJson(after),
      });
    }
  }

  return events;
}

/**
 * Write timeline rows. Never throws: a task update that succeeded must not be
 * reported as failed because its history entry did not write. Mirrors how
 * `recordAudit` treats the audit log.
 */
export async function recordTaskEvents(input: {
  taskId: string;
  actorUserId: string | null;
  events: PendingEvent[];
}): Promise<void> {
  if (input.events.length === 0) return;
  try {
    await prisma.taskEvent.createMany({
      data: input.events.map((e) => ({
        taskId: input.taskId,
        actorUserId: input.actorUserId,
        type: e.type,
        fromValue: e.fromValue,
        toValue: e.toValue,
      })),
    });
  } catch (err) {
    logger.exception(err, { where: "recordTaskEvents", taskId: input.taskId });
  }
}

export async function recordTaskEvent(input: {
  taskId: string;
  actorUserId: string | null;
  type: TaskEventType;
  body?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
}): Promise<void> {
  try {
    await prisma.taskEvent.create({
      data: {
        taskId: input.taskId,
        actorUserId: input.actorUserId,
        type: input.type,
        body: input.body ?? null,
        fromValue: input.fromValue ?? null,
        toValue: input.toValue ?? null,
      },
    });
  } catch (err) {
    logger.exception(err, { where: "recordTaskEvent", taskId: input.taskId });
  }
}
