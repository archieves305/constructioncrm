// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueChange, ownerChange, pendingFor } from "../outbox/pending";
import { isOverdue, moveChoices } from "./triage";

test("one-tap days: next Monday is the coming Monday, never today", () => {
  const wed = moveChoices("2026-11-11"); // a Wednesday
  assert.deepEqual(wed.map((c) => c.day), ["2026-11-11", "2026-11-12", "2026-11-16", "2026-11-18"]);
  const mon = moveChoices("2026-11-16"); // a Monday: next Monday is a week on, same as "In a week"
  assert.deepEqual(mon.map((c) => c.label), ["Today", "Tomorrow", "Next Monday"]);
  const sun = moveChoices("2026-11-15"); // Sunday: tomorrow is Monday
  assert.deepEqual(sun.map((c) => c.label), ["Today", "Tomorrow", "In a week"]);
});

test("owner and date changes carry what the phone last saw", () => {
  assert.deepEqual(ownerChange("u1", "u2"), { assignedUserId: "u2", expect: { assignedUserId: "u1" } });
  assert.deepEqual(dueChange("2026-11-10T16:00:00.000Z", "2026-11-12"), { dueAt: "2026-11-12", expect: { dueAt: "2026-11-10T16:00:00.000Z" } });
  assert.deepEqual(dueChange(null, null), { dueAt: null, expect: { dueAt: null } });
});

test("unsent owner and date changes show at once", () => {
  const op = (body: unknown) => ({ id: "o", userId: "u", kind: "task.update", targetId: "t1", method: "PATCH", path: "/api/tasks/t1", body, label: "", state: "queued", createdAt: 1, attempts: 0, nextTryAt: 0, idempotencyKey: "k", error: null, errorCode: null, errorBody: null });
  const v = pendingFor([op(ownerChange("u1", "u2")), op(dueChange(null, "2026-11-12"))] as never, "t1");
  assert.equal(v.assignedUserId, "u2");
  assert.equal(v.dueDay, "2026-11-12");
});

test("overdue: before today, open only", () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  assert.equal(isOverdue({ status: "PENDING", dueAt: "2026-11-07T16:00:00Z" }, "2026-11-08", dayOf), true);
  assert.equal(isOverdue({ status: "PENDING", dueAt: "2026-11-08T16:00:00Z" }, "2026-11-08", dayOf), false);
  assert.equal(isOverdue({ status: "COMPLETED", dueAt: "2026-11-01T16:00:00Z" }, "2026-11-08", dayOf), false);
  assert.equal(isOverdue({ status: "PENDING", dueAt: null }, "2026-11-08", dayOf), false);
});
