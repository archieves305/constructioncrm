import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpLine } from "./leads";

const now = new Date("2026-11-09T15:00:00Z"); // 10 am in the office

test("never contacted is shown first, as late", () => {
  assert.deepEqual(followUpLine(null, null, now), { text: "Never contacted", late: true });
});
test("due today, late and later", () => {
  assert.equal(followUpLine("2026-11-09T14:00:00Z", "2026-11-01T12:00:00Z", now).text, "Follow up today");
  assert.deepEqual(followUpLine("2026-11-06T14:00:00Z", "2026-11-01T12:00:00Z", now), { text: "Follow up 3 days late", late: true });
  assert.equal(followUpLine("2026-11-12T14:00:00Z", "2026-11-01T12:00:00Z", now).text, "Follow up Nov 12");
});
test("contacted with no follow-up set", () => {
  assert.equal(followUpLine(null, "2026-11-01T12:00:00Z", now).text, "No follow-up set");
});
