import { test } from "node:test";
import assert from "node:assert/strict";
import { isCrewRole, isForeman, problemIssue, startLabel } from "./crew";

test("crew roles get the crew mode; office roles don't", () => {
  assert.equal(isCrewRole("CREW_LEAD"), true);
  assert.equal(isCrewRole("CREW_MEMBER"), true);
  assert.equal(isCrewRole("ADMIN"), false);
  assert.equal(isCrewRole(undefined), false);
});

test("a problem becomes the right kind of field issue", () => {
  assert.deepEqual(problemIssue("safety", "Loose rail on stairs", false), { type: "SAFETY", title: "Safety: Loose rail on stairs", priority: "HIGH", description: undefined });
  assert.equal(problemIssue("materials", "", false).type, "MATERIAL_REQUEST");
  assert.equal(problemIssue("materials", "", false).title, "Missing materials");
  assert.equal(problemIssue("quality", "x", false).type, "PUNCH");
  assert.equal(problemIssue("other", "x", false).type, "OFFICE_FOLLOW_UP");
  assert.equal(problemIssue("condition", "x", true).priority, "URGENT");
  assert.equal(problemIssue("condition", "x", false).priority, "MEDIUM");
  const long = problemIssue("blocked", "Waiting on inspector\nHe said after lunch", false);
  assert.equal(long.title, "Work blocked: Waiting on inspector");
  assert.equal(long.description, "Waiting on inspector\nHe said after lunch");
});

test("start times read as a clock", () => {
  assert.equal(startLabel(450), "7:30 AM");
  assert.equal(startLabel(0), "12:00 AM");
  assert.equal(startLabel(780), "1:00 PM");
  assert.equal(startLabel(null), null);
  assert.equal(startLabel(1440), null);
});

test("a crew member does not keep the log or the crew sheet", () => {
  assert.equal(isForeman("CREW_MEMBER"), false);
  assert.equal(isForeman("CREW_LEAD"), true);
  assert.equal(isForeman("ADMIN"), true);
});
