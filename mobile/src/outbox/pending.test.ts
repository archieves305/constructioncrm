// Run: npx tsx --test src/outbox/pending.test.ts   (pure; no Expo modules load)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OutboxOp } from "./outbox";
import { checklistTick, completeWithChecklist, mergeLogSave, mergedChecklist, rebaseAfter, pendingFor, statusChange, withoutExpect } from "./pending";

const op = (over: Partial<OutboxOp>): OutboxOp => ({
  id: "o1",
  userId: "u1",
  kind: "task.update",
  targetId: "t1",
  method: "PATCH",
  path: "/api/tasks/t1",
  body: {},
  label: "",
  idempotencyKey: "k",
  attempts: 0,
  state: "queued",
  error: null,
  errorCode: null,
  errorBody: null,
  createdAt: 1,
  nextTryAt: 0,
  ...over,
});

test("a queued Done shows as done and sending", () => {
  const v = pendingFor([op({ body: { status: "COMPLETED", expect: { status: "PENDING" } } })], "t1");
  assert.equal(v.status, "COMPLETED");
  assert.equal(v.waiting, true);
  assert.equal(v.failed.length, 0);
});

test("the latest queued change wins; other tasks are ignored", () => {
  const v = pendingFor(
    [
      op({ id: "a", body: { status: "BLOCKED", blockedReason: "Rain" } }),
      op({ id: "b", body: { status: "PENDING", blockedReason: null } }),
      op({ id: "c", targetId: "t2", body: { status: "COMPLETED" } }),
    ],
    "t1",
  );
  assert.equal(v.status, "PENDING");
  assert.equal(v.blockedReason, null);
});

test("a refused change is not shown as applied", () => {
  const v = pendingFor([op({ state: "failed", body: { status: "COMPLETED" }, error: "Finish the checklist first" })], "t1");
  assert.equal(v.status, undefined);
  assert.equal(v.failed.length, 1);
  assert.equal(v.waiting, false);
});

test("queued notes are listed", () => {
  const v = pendingFor([op({ kind: "task.note", body: { body: "Trusses here" } })], "t1");
  assert.deepEqual(v.notes.map((n) => n.body), ["Trusses here"]);
});

test("a status change carries what the phone last saw", () => {
  assert.deepEqual(statusChange({ status: "PENDING", blockedReason: null }, { status: "COMPLETED" }), {
    status: "COMPLETED",
    expect: { status: "PENDING" },
  });
  assert.deepEqual(statusChange({ status: "PENDING", blockedReason: null }, { status: "BLOCKED", blockedReason: "Rain" }), {
    status: "BLOCKED",
    blockedReason: "Rain",
    expect: { status: "PENDING", blockedReason: null },
  });
});

test("send mine anyway drops only the check", () => {
  assert.deepEqual(withoutExpect({ status: "COMPLETED", expect: { status: "PENDING" } }), { status: "COMPLETED" });
});

test("unsent ticks are laid over the server's checklist, latest wins", () => {
  const v = pendingFor(
    [
      op({ id: "a", body: checklistTick("item_1", true) }),
      op({ id: "b", body: checklistTick("item_2", true) }),
      op({ id: "c", body: checklistTick("item_1", false) }),
    ],
    "t1",
  );
  assert.deepEqual(v.checklist, { item_1: false, item_2: true });
  const merged = mergedChecklist(
    [
      { key: "item_1", label: "PM set", done: true },
      { key: "item_2", label: "Super set", done: false },
      { key: "item_3", label: "Start date set", done: false },
    ],
    v.checklist,
  );
  assert.deepEqual(merged.map((l) => [l.key, l.done, l.sending]), [
    ["item_1", false, true],
    ["item_2", true, true],
    ["item_3", false, false],
  ]);
});

test("completing ticks the open lines in the same request, with the conflict check", () => {
  assert.deepEqual(completeWithChecklist("PENDING", ["item_2", "item_3"]), {
    status: "COMPLETED",
    checklist: [{ key: "item_2", done: true }, { key: "item_3", done: true }],
    expect: { status: "PENDING" },
  });
  assert.deepEqual(completeWithChecklist("PENDING", []), { status: "COMPLETED", expect: { status: "PENDING" } });
});

test("a second unsent log save keeps the first one's starting copy", () => {
  assert.deepEqual(
    mergeLogSave({ workPerformed: "old", baseUpdatedAt: "2026-11-08T10:00:00.000Z" }, { workPerformed: "new", baseUpdatedAt: "2026-11-08T11:00:00.000Z" }),
    { workPerformed: "new", baseUpdatedAt: "2026-11-08T10:00:00.000Z" },
  );
  // A log that did not exist when first saved: no starting copy, even if the second save thinks so.
  assert.deepEqual(mergeLogSave({ workPerformed: "old" }, { workPerformed: "new", baseUpdatedAt: "x" }), { workPerformed: "new" });
});

test("send mine anyway also drops a log's starting copy", () => {
  assert.deepEqual(withoutExpect({ notes: "n", baseUpdatedAt: "x" }), { notes: "n" });
});

test("after the write-up lands, the crew save based on the same copy moves on", () => {
  const base = "2026-11-08T10:00:00.000Z";
  const now = "2026-11-08T10:05:00.000Z";
  assert.deepEqual(rebaseAfter({ notes: "n", baseUpdatedAt: base }, { updatedAt: now }, { entries: [], baseUpdatedAt: base }), { entries: [], baseUpdatedAt: now });
  // Based on another copy: left alone, so a real clash is still refused.
  assert.equal(rebaseAfter({ baseUpdatedAt: base }, { updatedAt: now }, { entries: [], baseUpdatedAt: "2026-11-08T09:00:00.000Z" }), null);
  // A new log (no base) or a reply without a timestamp: nothing to do.
  assert.equal(rebaseAfter({ notes: "n" }, { updatedAt: now }, { entries: [] }), null);
  assert.equal(rebaseAfter({ baseUpdatedAt: base }, { ok: true }, { baseUpdatedAt: base }), null);
});
