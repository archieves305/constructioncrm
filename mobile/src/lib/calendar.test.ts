// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarItemDto } from "@crm/mobile-api";
import { groupByDay, orderDay } from "./calendar";

const item = (over: Partial<CalendarItemDto>): CalendarItemDto =>
  ({
    kind: "task",
    id: "t",
    title: "t",
    status: "PENDING",
    priority: "MEDIUM",
    derived: "not_started",
    allDay: true,
    start: null,
    end: null,
    dayKey: "2026-11-09",
    dueAt: null,
    completedAt: null,
    assignedTo: null,
    job: null,
    lead: null,
    blocking: false,
    blockedReason: null,
    workflowTaskKey: null,
    checklist: { done: 0, total: 0 },
    counts: { notes: 0, files: 0, waitingOn: 0 },
    overlay: null,
    ...over,
  }) as CalendarItemDto;

test("a week keeps every day, even empty ones, in date order", () => {
  const week = groupByDay([item({ id: "a", dayKey: "2026-11-11" })], "2026-11-09", 7);
  assert.deepEqual(week.map((d) => d.day), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.deepEqual(week.map((d) => d.items.length), [0, 0, 1, 0, 0, 0, 0]);
});

test("items outside the week and undated items are left out", () => {
  const week = groupByDay([item({ id: "out", dayKey: "2026-11-20" }), item({ id: "none", dayKey: null })], "2026-11-09", 7);
  assert.equal(week.reduce((n, d) => n + d.items.length, 0), 0);
});

test("within a day: records, then timed by start, then all-day; finished last", () => {
  const week = groupByDay(
    [
      item({ id: "allday" }),
      item({ id: "done", status: "COMPLETED" }),
      item({ id: "late", allDay: false, start: "2026-11-09T20:00:00Z" }),
      item({ id: "early", allDay: false, start: "2026-11-09T13:00:00Z" }),
      item({ id: "insp", kind: "permit_inspection", start: "2026-11-09T15:00:00Z" }),
    ],
    "2026-11-09",
    1,
  );
  assert.deepEqual(week[0].items.map((i) => i.id), ["insp", "early", "late", "allday", "done"]);
});

test("orderDay leaves the input alone", () => {
  const input = [item({ id: "b", allDay: true }), item({ id: "a", kind: "job_start" })];
  orderDay(input);
  assert.deepEqual(input.map((i) => i.id), ["b", "a"]);
});
