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
};

export function pendingFor(ops: OutboxOp[], taskId: string): PendingView {
  const mine = ops.filter((o) => o.targetId === taskId);
  const view: PendingView = { waiting: false, failed: [], notes: [], photos: 0 };
  for (const op of mine) {
    if (op.state === "failed") view.failed.push(op);
    else view.waiting = true;
    if (op.kind === "task.update" && op.state === "queued") {
      const b = op.body as { status?: string; blockedReason?: string | null };
      if (b.status !== undefined) view.status = b.status;
      if (b.blockedReason !== undefined) view.blockedReason = b.blockedReason;
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
  const { expect: _drop, ...rest } = body as Record<string, unknown>;
  void _drop;
  return rest;
}
