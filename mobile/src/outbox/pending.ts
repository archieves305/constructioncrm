import type { OutboxOp } from "./outbox";

/**
 * What a task looks like with the phone's unsent changes laid over the
 * server's copy, so the screen shows "Done" the moment it is tapped.
 */
export type PendingView = {
  status?: string;
  blockedReason?: string | null;
  /** Something for this task is still waiting to be sent. */
  waiting: boolean;
  /** Changes the server refused; shown until retried or discarded. */
  failed: OutboxOp[];
  notes: { id: string; body: string; createdAt: number; failed: boolean }[];
  /** Photos for this record still on the phone. */
  photos: number;
  /** Checklist ticks not sent yet: line key → ticked. */
  checklist: Record<string, boolean>;
  /** An owner change not sent yet (null = nobody). */
  assignedUserId?: string | null;
  /** A date change not sent yet: yyyy-MM-dd, or null for no date. */
  dueDay?: string | null;
};

export function pendingFor(ops: OutboxOp[], taskId: string): PendingView {
  const mine = ops.filter((o) => o.targetId === taskId);
  const view: PendingView = { waiting: false, failed: [], notes: [], photos: 0, checklist: {} };
  for (const op of mine) {
    if (op.state === "failed") view.failed.push(op);
    else view.waiting = true;
    if (op.kind === "task.update" && op.state === "queued") {
      const b = op.body as { status?: string; blockedReason?: string | null; checklist?: { key: string; done: boolean }[] };
      if (b.status !== undefined) view.status = b.status;
      if (b.blockedReason !== undefined) view.blockedReason = b.blockedReason;
      const t = b as { assignedUserId?: string | null; dueAt?: string | null };
      if (t.assignedUserId !== undefined) view.assignedUserId = t.assignedUserId;
      if (t.dueAt !== undefined) view.dueDay = t.dueAt;
      for (const line of b.checklist ?? []) view.checklist[line.key] = line.done;
    }
    if (op.kind === "file.upload" && op.state === "queued") view.photos += 1;
    if (op.kind === "task.note") {
      view.notes.push({ id: op.id, body: String((op.body as { body?: string }).body ?? ""), createdAt: op.createdAt, failed: op.state === "failed" });
    }
  }
  return view;
}

/** The task update body for a status change, with what the phone last saw. */
export function statusChange(
  seen: { status: string; blockedReason: string | null },
  next: { status: "COMPLETED" | "BLOCKED" | "PENDING"; blockedReason?: string | null },
) {
  const body: Record<string, unknown> = { status: next.status, expect: { status: seen.status } };
  if (next.blockedReason !== undefined) {
    body.blockedReason = next.blockedReason;
    (body.expect as Record<string, unknown>).blockedReason = seen.blockedReason;
  }
  return body;
}

/** The same change without the conflict check ("send mine anyway"). */
export function withoutExpect(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const { expect: _drop, baseUpdatedAt: _base, ...rest } = body as Record<string, unknown>;
  void _drop;
  void _base;
  return rest;
}

/** Tick or untick one checklist line (no conflict check: ticks are per line). */
export function checklistTick(key: string, done: boolean) {
  return { checklist: [{ key, done }] };
}

/** Complete a step, ticking every open line in the same request (the web's "Tick all"). */
export function completeWithChecklist(seenStatus: string, keys: string[]) {
  return {
    status: "COMPLETED",
    ...(keys.length ? { checklist: keys.map((key) => ({ key, done: true })) } : {}),
    expect: { status: seenStatus },
  };
}

/** The checklist as the screen shows it: the server's copy with unsent ticks laid over it. */
export function mergedChecklist(server: { key: string; label: string; done: boolean }[] | null | undefined, pending: Record<string, boolean>) {
  return (server ?? []).map((line) => ({ ...line, done: pending[line.key] ?? line.done, sending: line.key in pending }));
}

/**
 * A log saved again before the first save was sent: the newer write-up wins,
 * but it keeps the copy the FIRST unsent save was based on (or none, for a
 * new log), because that is what the server still holds.
 */
export function mergeLogSave(prior: unknown, next: unknown): Record<string, unknown> {
  const base = (prior as { baseUpdatedAt?: string } | null)?.baseUpdatedAt;
  const body = { ...(next as Record<string, unknown>) };
  if (base) body.baseUpdatedAt = base;
  else delete body.baseUpdatedAt;
  return body;
}

/**
 * After a save to a daily log landed (`result` is the log as it now stands),
 * a later queued save based on the SAME copy as the one just sent is moved
 * onto the new copy: it was the phone's own change, not someone else's.
 * Returns the new body, or null when nothing changes. A later save based on
 * another copy keeps its base, so a real clash is still caught.
 */
export function rebaseAfter(sent: unknown, result: unknown, later: unknown): Record<string, unknown> | null {
  const sentBase = (sent as { baseUpdatedAt?: unknown } | null)?.baseUpdatedAt;
  const next = (result as { updatedAt?: unknown } | null)?.updatedAt;
  const laterBody = later as Record<string, unknown> | null;
  if (typeof sentBase !== "string" || typeof next !== "string" || !laterBody) return null;
  if (laterBody.baseUpdatedAt !== sentBase) return null;
  return { ...laterBody, baseUpdatedAt: next };
}

/** Give the task to someone else (null = nobody), checked against the owner the phone last saw. */
export function ownerChange(seenAssigneeId: string | null, next: string | null) {
  return { assignedUserId: next, expect: { assignedUserId: seenAssigneeId } };
}

/**
 * Move the task to a day (yyyy-MM-dd; the CRM keeps a timed task's window and
 * moves it with the day) or clear its date (null), checked against the due
 * date the phone last saw.
 */
export function dueChange(seenDueAt: string | null, nextDay: string | null) {
  return { dueAt: nextDay, expect: { dueAt: seenDueAt } };
}
