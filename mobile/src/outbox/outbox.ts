import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { api, ApiError } from "@/api/client";
import { deleteQueuedPhoto } from "@/photos/prepare";
import { sendUpload, type UploadBody } from "./upload";
import { mergeLogSave, rebaseAfter } from "./pending";

/**
 * The outbox (CAREYOS_MOBILE_APP_PLAN.md §F.3): every change made on the phone
 * is saved here first and sent in the background, one at a time per record,
 * oldest first. It survives no signal and the app being closed.
 *
 *   - each change carries an Idempotency-Key made when it was queued, so a
 *     resend after a dropped connection is answered without a second write;
 *   - no signal, a server hiccup (5xx) or "still running" (409 in_progress):
 *     kept and retried with back-off;
 *   - a refusal (400 / 403 / 404 / 409 conflict): kept as "needs attention"
 *     with the server's own sentence, until the person retries or discards it;
 *   - signed out (401): nothing is sent until the same person signs in again.
 */

export type OutboxKind = "task.update" | "task.note" | "task.create" | "file.upload" | "issue.create" | "log.save" | "labor.save" | "log.submit" | "lead.note" | "expense.create" | "lead.contact" | "lead.update";

export type OutboxOp = {
  id: string;
  userId: string;
  kind: OutboxKind;
  /** The record it changes (task id), for showing it beside that record. */
  targetId: string;
  method: "POST" | "PATCH" | "PUT";
  path: string;
  body: unknown;
  /** What the change looks like, in words: "Mark done", "Note: …". */
  label: string;
  idempotencyKey: string;
  attempts: number;
  state: "queued" | "failed";
  error: string | null;
  errorCode: string | null;
  /** A conflict's current record from the server. */
  errorBody: unknown;
  createdAt: number;
  nextTryAt: number;
};

type Row = Omit<OutboxOp, "body" | "errorBody"> & { body: string; errorBody: string | null };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("knu-field-outbox.db");
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY NOT NULL,
        userId TEXT NOT NULL,
        kind TEXT NOT NULL,
        targetId TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        body TEXT NOT NULL,
        label TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        errorCode TEXT,
        errorBody TEXT,
        createdAt INTEGER NOT NULL,
        nextTryAt INTEGER NOT NULL DEFAULT 0
      );
    `);
    return d;
  })();
  return dbPromise;
}

const fromRow = (r: Row): OutboxOp => ({
  ...r,
  body: JSON.parse(r.body),
  errorBody: r.errorBody ? JSON.parse(r.errorBody) : null,
});

// --- change notification for screens ---------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let onSent: ((op: OutboxOp, result: unknown) => void) | null = null;
/** The app tells the outbox what to refresh after a change lands. */
export function setOnSent(fn: typeof onSent) {
  onSent = fn;
}
function changed() {
  listeners.forEach((fn) => fn());
}

export async function listOps(userId: string): Promise<OutboxOp[]> {
  const rows = await (await db()).getAllAsync<Row>(
    "SELECT * FROM outbox WHERE userId = ? ORDER BY createdAt ASC",
    userId,
  );
  return rows.map(fromRow);
}

export async function enqueue(
  op: Pick<OutboxOp, "userId" | "kind" | "targetId" | "method" | "path" | "body" | "label">,
): Promise<OutboxOp> {
  // A log saved twice without signal: send only the latest, based on the copy
  // the first unsent save started from, so the two never conflict with each other.
  if (op.kind === "log.save" || op.kind === "labor.save") {
    const d = await db();
    const prior = await d.getFirstAsync<Row>(
      "SELECT * FROM outbox WHERE userId = ? AND kind = ? AND targetId = ? AND state = 'queued' ORDER BY createdAt ASC",
      op.userId, op.kind, op.targetId,
    );
    if (prior) {
      op = { ...op, body: mergeLogSave(JSON.parse(prior.body), op.body) };
      await d.runAsync("DELETE FROM outbox WHERE userId = ? AND kind = ? AND targetId = ? AND state = 'queued'", op.userId, op.kind, op.targetId);
    }
  }
  const full: OutboxOp = {
    ...op,
    id: Crypto.randomUUID(),
    idempotencyKey: Crypto.randomUUID(),
    attempts: 0,
    state: "queued",
    error: null,
    errorCode: null,
    errorBody: null,
    createdAt: Date.now(),
    nextTryAt: 0,
  };
  await (await db()).runAsync(
    `INSERT INTO outbox (id, userId, kind, targetId, method, path, body, label, idempotencyKey, attempts, state, createdAt, nextTryAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'queued', ?, 0)`,
    full.id, full.userId, full.kind, full.targetId, full.method, full.path, JSON.stringify(full.body), full.label, full.idempotencyKey, full.createdAt,
  );
  changed();
  void flush(op.userId);
  return full;
}

/** Try a failed change again; `body` replaces what is sent (e.g. without `expect`). */
export async function retry(id: string, userId: string, body?: unknown): Promise<void> {
  const d = await db();
  if (body !== undefined) {
    // A different request needs a new key, or the server would replay the refusal.
    await d.runAsync(
      "UPDATE outbox SET state='queued', error=NULL, errorCode=NULL, errorBody=NULL, nextTryAt=0, body=?, idempotencyKey=? WHERE id=?",
      JSON.stringify(body), Crypto.randomUUID(), id,
    );
  } else {
    await d.runAsync(
      "UPDATE outbox SET state='queued', error=NULL, errorCode=NULL, errorBody=NULL, nextTryAt=0, idempotencyKey=? WHERE id=?",
      Crypto.randomUUID(), id,
    );
  }
  changed();
  void flush(userId);
}

function dropFiles(ops: OutboxOp[]) {
  for (const o of ops) if (o.kind === "file.upload") deleteQueuedPhoto((o.body as UploadBody).filePath);
}

export async function discard(id: string): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<Row>("SELECT * FROM outbox WHERE id = ?", id);
  if (row?.kind === "issue.create") {
    // A new issue dropped: its queued photos have nothing to attach to.
    const behind = (await d.getAllAsync<Row>("SELECT * FROM outbox WHERE targetId = ?", row.targetId)).map(fromRow);
    dropFiles(behind);
    await d.runAsync("DELETE FROM outbox WHERE targetId = ?", row.targetId);
  } else if (row) dropFiles([fromRow(row)]);
  await d.runAsync("DELETE FROM outbox WHERE id = ?", id);
  changed();
}

/** Sign-out with nothing waiting, or after the person agreed to drop it. */
export async function clearFor(userId: string): Promise<void> {
  dropFiles(await listOps(userId));
  await (await db()).runAsync("DELETE FROM outbox WHERE userId = ?", userId);
  changed();
}

const backoffMs = (attempts: number) => Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

let running: Promise<void> | null = null;

/** Send what can be sent now. Safe to call often; one run at a time. */
export function flush(userId: string): Promise<void> {
  running ??= (async () => {
    try {
      const d = await db();
      // Oldest first; a record's later changes wait for its earlier ones.
      const ops = (await listOps(userId)).filter((o) => o.state === "queued");
      const blockedTargets = new Set<string>();
      // Changes to one record go in order; each photo stands alone, so one
      // refused photo never holds up the rest.
      // Photos behind a new issue or a day's log (targets "issue:…", "log:…") wait for it.
      const lane = (o: OutboxOp) => (o.kind === "file.upload" && !o.targetId.includes(":") ? o.id : o.targetId);
      for (const op of ops) {
        if (blockedTargets.has(lane(op))) continue;
        if (op.nextTryAt > Date.now()) {
          blockedTargets.add(lane(op));
          continue;
        }
        try {
          const result =
            op.kind === "file.upload"
              ? await sendUpload(op.body as UploadBody, op.idempotencyKey, op.path)
              : await api(op.path, { method: op.method, body: op.body, idempotencyKey: op.idempotencyKey });
          await d.runAsync("DELETE FROM outbox WHERE id = ?", op.id);
          // The log's write-up and its crew sheet share one timestamp: a later
          // save based on the same copy as this one moves onto the new one.
          for (const later of ops) {
            if (later === op || later.targetId !== op.targetId || later.state !== "queued") continue;
            const rebased = rebaseAfter(op.body, result, later.body);
            if (rebased) {
              later.body = rebased;
              await d.runAsync("UPDATE outbox SET body = ? WHERE id = ?", JSON.stringify(rebased), later.id);
            }
          }
          dropFiles([op]);
          onSent?.(op, result);
          changed();
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(String(e), 0, "unknown");
          if (err.status === 401) return; // signed out: keep everything, stop
          const transient = err.offline || err.status >= 500 || err.status === 429 || err.code === "in_progress";
          if (transient) {
            await d.runAsync(
              "UPDATE outbox SET attempts = attempts + 1, nextTryAt = ?, error = ? WHERE id = ?",
              Date.now() + backoffMs(op.attempts + 1), err.offline ? "Waiting for signal" : err.message, op.id,
            );
            blockedTargets.add(lane(op));
            if (err.offline) break; // no point trying the rest
          } else {
            // A 409 without a code is a clash with someone else's edit (the
            // daily log route says "Log was modified elsewhere").
            const code = err.code ?? (err.status === 409 ? "conflict" : null);
            await d.runAsync(
              "UPDATE outbox SET state='failed', attempts = attempts + 1, error = ?, errorCode = ?, errorBody = ? WHERE id = ?",
              err.message, code, err.body ? JSON.stringify(err.body) : null, op.id,
            );
            blockedTargets.add(lane(op));
          }
          changed();
        }
      }
    } finally {
      running = null;
    }
  })();
  return running;
}
