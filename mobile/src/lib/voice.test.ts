// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueChoice, mergeLogDraft } from "./voice";

test("a drafted due day picks the form's choice", () => {
  assert.equal(dueChoice(null, "2026-11-08"), "none");
  assert.equal(dueChoice("2026-11-08", "2026-11-08"), "today");
  assert.equal(dueChoice("2026-11-09", "2026-11-08"), "tomorrow");
  assert.equal(dueChoice("2026-11-15", "2026-11-08"), "week");
  assert.equal(dueChoice("2026-11-13", "2026-11-08"), "date");
});

test("spoken text is added after what is written, never over it", () => {
  const { form, changed } = mergeLogDraft(
    { workPerformed: "Framed the north wall", delays: "", safetyToolboxTalk: false },
    { workPerformed: "Set trusses", delays: "Rain until 10", safetyToolboxTalk: true },
  );
  assert.equal(form.workPerformed, "Framed the north wall\nSet trusses");
  assert.equal(form.delays, "Rain until 10");
  assert.equal(form.safetyToolboxTalk, true);
  assert.deepEqual(changed, ["workPerformed", "delays", "safetyToolboxTalk"]);
});

test("saying the same thing twice does not repeat it", () => {
  const { form, changed } = mergeLogDraft({ workPerformed: "Framed the north wall\nSet trusses" }, { workPerformed: "Set trusses" });
  assert.equal(form.workPerformed, "Framed the north wall\nSet trusses");
  assert.deepEqual(changed, []);
});
