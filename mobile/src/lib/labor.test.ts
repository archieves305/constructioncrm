// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, entryHours, markAbsent, newEntry, nowMinutes, sheetHours, stepTime, toInput } from "./labor";

const person = { id: "p1", firstName: "Ana", lastName: "Ruiz", trade: "Framing", crew: null };

test("hours: start to end less the break; absent or missing times count nothing", () => {
  const e = newEntry(person, "c0123456789abcdef01234567");
  assert.equal(entryHours(e), 8); // 7:00 – 3:30 less 30 min
  assert.equal(entryHours({ ...e, breakMinutes: 0 }), 8.5);
  assert.equal(entryHours(markAbsent(e, true)), 0);
  assert.equal(entryHours({ ...e, endMinutes: null }), 0);
  assert.equal(entryHours({ ...e, startMinutes: 22 * 60, endMinutes: 1440 + 2 * 60, breakMinutes: 0 }), 4); // past midnight
  assert.equal(sheetHours([e, { ...e, breakMinutes: 0 }]), 16.5);
});

test("clock labels, including past midnight", () => {
  assert.equal(clock(420), "7:00 AM");
  assert.equal(clock(930), "3:30 PM");
  assert.equal(clock(0), "12:00 AM");
  assert.equal(clock(720), "12:00 PM");
  assert.equal(clock(1440 + 90), "1:30 AM (next day)");
  assert.equal(clock(null), "—");
});

test("stepping lands on the step and stays inside the CRM's range", () => {
  assert.equal(stepTime(427, 15, 420), 435); // 7:07 → 7:15 (rounded onto the quarter)
  assert.equal(stepTime(420, -15, 420), 405);
  assert.equal(stepTime(5, -15, 420), 0);
  assert.equal(stepTime(2870, 15, 420), 2879);
  assert.equal(stepTime(null, 15, 930), 945);
});

test("now in the office's zone, rounded to 5 minutes; an end before the start is the next day", () => {
  const at = new Date("2026-11-08T14:32:00Z"); // 9:32 AM in New York (EST)
  assert.equal(nowMinutes(at), 9 * 60 + 30);
  const late = new Date("2026-11-09T06:10:00Z"); // 1:10 AM
  assert.equal(nowMinutes(late, 22 * 60), 1440 + 70);
});

test("a save sends the office's fields back untouched and never a rate", () => {
  const server = { ...newEntry(person, "c0123456789abcdef01234567"), costCodeId: "cc9", phase: "Rough", budgetLineId: "b1", totalHours: 8, regularHours: 8, otHours: 0, regularRate: 30, personnel: { id: "p1", firstName: "Ana", lastName: "Ruiz" } };
  const out = toInput(server as never);
  assert.equal(out.costCodeId, "cc9");
  assert.equal(out.phase, "Rough");
  assert.equal(out.budgetLineId, "b1");
  assert.ok(!("regularRate" in out) && !("totalHours" in out) && !("personnel" in out));
});

test("absent clears the times; back again restores the defaults", () => {
  const e = { ...newEntry(person, "c0123456789abcdef01234567"), absenceReason: null };
  const off = { ...markAbsent(e, true), absenceReason: "Sick" };
  assert.equal(off.startMinutes, null);
  const back = markAbsent(off, false);
  assert.deepEqual([back.startMinutes, back.endMinutes, back.absenceReason], [420, 930, null]);
});
