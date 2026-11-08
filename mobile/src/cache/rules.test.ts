// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_AGE_MS, keepQueries, savedLabel, shouldPersist, warmDue } from "./rules";

test("only the CRM's read data is kept", () => {
  assert.ok(shouldPersist(["job", "j1"]));
  assert.ok(shouldPersist(["calendar", "day", "2026-11-08"]));
  assert.ok(shouldPersist(["dailyLog", "j1", "2026-11-08", "sheet"]));
  assert.ok(!shouldPersist(["session"]));
  assert.ok(!shouldPersist([42]));
});

test("failed, unknown or week-old queries are dropped", () => {
  const now = Date.UTC(2026, 10, 8, 20);
  const qs = [
    { queryKey: ["job", "a"], state: { status: "success", dataUpdatedAt: now - 60_000 } },
    { queryKey: ["job", "b"], state: { status: "error", dataUpdatedAt: now - 60_000 } },
    { queryKey: ["other"], state: { status: "success", dataUpdatedAt: now } },
    { queryKey: ["job", "c"], state: { status: "success", dataUpdatedAt: now - MAX_AGE_MS - 1 } },
  ];
  assert.deepEqual(keepQueries(qs, now).map((x) => x.queryKey[1]), ["a"]);
});

test("saved labels in the office's time", () => {
  const now = Date.UTC(2026, 10, 8, 20, 0); // 3:00 PM New York
  assert.equal(savedLabel(Date.UTC(2026, 10, 8, 19, 15), now), "Saved 2:15 PM");
  assert.equal(savedLabel(Date.UTC(2026, 10, 7, 21, 40), now), "Saved yesterday 4:40 PM");
  assert.equal(savedLabel(Date.UTC(2026, 10, 3, 15, 0), now), "Saved Nov 3");
});

test("the background refresh waits 15 minutes and needs signal", () => {
  const now = 10_000_000;
  assert.ok(warmDue(null, now, true));
  assert.ok(!warmDue(null, now, false));
  assert.ok(!warmDue(now - 60_000, now, true));
  assert.ok(warmDue(now - 16 * 60_000, now, true));
});
