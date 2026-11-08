// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, clockIn, clockOut, entryHours, hoursSoFar, isOnSite, markAbsent, newEntry, nowMinutes, sheetHours, stepTime, toInput } from "./labor";

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

test("clocking in: new people start now with no end; an absent person who turns up goes on site", () => {
  const at = new Date("2026-11-08T12:05:00Z"); // 7:05 AM New York
  const bob = { id: "p2", firstName: "Bob", lastName: "Lee", trade: null, crew: null };
  const absent = { ...markAbsent(newEntry(bob, "c0123456789abcdef0000000b"), true), absenceReason: "Late call" };
  let n = 0;
  const out = clockIn([absent], [person, bob], () => `c0123456789abcdef000000${n++}a`, at);
  assert.equal(out.length, 2);
  const ana = out.find((e) => e.personnelId === "p1")!;
  assert.deepEqual([ana.startMinutes, ana.endMinutes, ana.breakMinutes], [425, null, 0]);
  const b = out.find((e) => e.personnelId === "p2")!;
  assert.deepEqual([b.isAbsent, b.startMinutes, b.endMinutes, b.absenceReason], [false, 425, null, null]);
  assert.ok(out.every(isOnSite));
  // Clocking in again changes nothing for people already on site.
  assert.deepEqual(clockIn(out, [person, bob], () => "x", at), out);
});

test("hours so far, and clocking out (one or everyone; past midnight)", () => {
  const start = new Date("2026-11-08T12:00:00Z"); // 7:00 AM
  let n = 0;
  const on = clockIn([], [person, { id: "p2", firstName: "B", lastName: "L", trade: null, crew: null }], () => `c0123456789abcdef000000${n++}b`, start);
  assert.equal(hoursSoFar(on[0], new Date("2026-11-08T15:15:00Z")), 3.3); // 10:15 AM
  const one = clockOut(on, [on[0].id], new Date("2026-11-08T20:30:00Z")); // 3:30 PM
  assert.deepEqual([one[0].endMinutes, isOnSite(one[0]), isOnSite(one[1])], [930, false, true]);
  const all = clockOut(one, null, new Date("2026-11-09T05:10:00Z")); // 12:10 AM next day
  assert.equal(all[1].endMinutes, 1440 + 10);
  assert.equal(all[0].endMinutes, 930); // already out: left alone
});
