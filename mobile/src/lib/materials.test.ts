import { test } from "node:test";
import assert from "node:assert/strict";
import { MATERIAL_STATUS, pastItems } from "./materials";

test("past items: newest first, each once, bullet lines only", () => {
  const items = pastItems([
    { description: "• 12 sheets 5/8 drywall\n• 2 boxes screws\n\nNeeded on site by Tue.", createdAt: "2026-11-01T10:00:00Z" },
    { description: "• 2 boxes screws\n• 1 bucket mud", createdAt: "2026-11-05T10:00:00Z" },
    { description: null, createdAt: "2026-11-06T10:00:00Z" },
  ]);
  assert.deepEqual(items, ["2 boxes screws", "1 bucket mud", "12 sheets 5/8 drywall"]);
});

test("a request's status reads as materials words", () => {
  assert.equal(MATERIAL_STATUS.IN_PROGRESS, "Ordered");
  assert.equal(MATERIAL_STATUS.COMPLETED, "Delivered");
});
