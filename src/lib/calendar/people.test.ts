import { describe, expect, it } from "vitest";
import { formatWorkload, peopleRows, workloadOf } from "./people";
import { makeItem, PEOPLE } from "./test-fixtures";

const users = PEOPLE.map((p) => ({ ...p, isActive: true })).concat([{ id: "u-old", firstName: "Old", lastName: "Timer", isActive: false }]);

describe("workloadOf", () => {
  it("counts distinct open tasks and sums timed minutes", () => {
    const span = makeItem({ id: "s" });
    const timed = makeItem({ id: "t", allDay: false, scheduledStart: "2026-09-29T13:00:00.000Z", dueAt: "2026-09-29T15:30:00.000Z", start: "2026-09-29T13:00:00.000Z", end: "2026-09-29T15:30:00.000Z" });
    const done = makeItem({ id: "d", status: "COMPLETED" });
    expect(workloadOf([span, span, timed, done])).toEqual({ open: 2, timedMinutes: 150 });
  });
});

describe("peopleRows", () => {
  const items = [
    makeItem({ id: "1", assignedUserId: "u-frank" }),
    makeItem({ id: "2", assignedUserId: "u-frank" }),
    makeItem({ id: "3", assignedUserId: "u-lisette" }),
    makeItem({ id: "4", assignedUserId: null, assignedTo: null }),
  ];
  it("Everyone: Unassigned first, then active people busiest first, ties by name; inactive users are not lanes", () => {
    const rows = peopleRows(items, users, { kind: "all" }, "u-richard");
    expect(rows.map((r) => r.id)).toEqual([null, "u-frank", "u-lisette", "u-richard"]);
    expect(rows[0].items.map((i) => i.id)).toEqual(["4"]);
    expect(rows[1].open).toBe(2);
    expect(rows[3].open).toBe(0);
  });
  it("a picked set shows only those lanes, plus Unassigned when asked", () => {
    expect(peopleRows(items, users, { kind: "ids", ids: ["u-lisette"], includeUnassigned: false }, "u-richard").map((r) => r.id)).toEqual(["u-lisette"]);
    expect(peopleRows(items, users, { kind: "ids", ids: ["u-lisette"], includeUnassigned: true }, "u-richard").map((r) => r.id)).toEqual([null, "u-lisette"]);
  });
  it("My calendar is one lane", () => {
    expect(peopleRows(items, users, { kind: "me" }, "u-frank").map((r) => r.id)).toEqual(["u-frank"]);
  });
});

describe("formatWorkload", () => {
  it("reads like the footer", () => {
    expect(formatWorkload({ open: 0, timedMinutes: 0 })).toBe("Nothing this week");
    expect(formatWorkload({ open: 1, timedMinutes: 0 })).toBe("1 task");
    expect(formatWorkload({ open: 9, timedMinutes: 390 })).toBe("9 tasks · 6.5 h timed");
    expect(formatWorkload({ open: 2, timedMinutes: 120 })).toBe("2 tasks · 2 h timed");
  });
});
