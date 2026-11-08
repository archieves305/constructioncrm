// Run: npx tsx --test src/outbox/pending.test.ts   (pure; no Expo modules load)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OutboxOp } from "./outbox";
import { pendingFor, statusChange, withoutExpect } from "./pending";

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
