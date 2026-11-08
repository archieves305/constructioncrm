// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyShort, phoneLink } from "./links";

test("jobs and tasks open in the app; everything else on the web", () => {
  assert.deepEqual(phoneLink("/jobs/cmo7890l80000o88ogp5ar2zt"), { kind: "job", id: "cmo7890l80000o88ogp5ar2zt" });
  assert.deepEqual(phoneLink("/tasks?task=t1&scope=all"), { kind: "task", id: "t1" });
  assert.deepEqual(phoneLink("/jobs/j1?tab=money"), { kind: "job", id: "j1" });
  assert.deepEqual(phoneLink("/jobs/j1/daily-logs/2026-11-08"), { kind: "web", path: "/jobs/j1/daily-logs/2026-11-08" });
  assert.deepEqual(phoneLink("/leads/l1"), { kind: "web", path: "/leads/l1" });
  assert.deepEqual(phoneLink("/permits/p1"), { kind: "web", path: "/permits/p1" });
});

test("money on a tile", () => {
  assert.equal(moneyShort(179040), "$179,040");
  assert.equal(moneyShort(1_240_000), "$1.2M");
  assert.equal(moneyShort(-5200.4), "−$5,200");
  assert.equal(moneyShort(0), "$0");
  assert.equal(moneyShort(-0.07), "$0"); // a few cents short is not a loss on a tile
});
