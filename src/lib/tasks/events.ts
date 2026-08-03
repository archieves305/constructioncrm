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
