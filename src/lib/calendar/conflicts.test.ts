import { describe, expect, it } from "vitest";
import { describeConflict, findConflicts, overlaps } from "./conflicts";
import { makeItem } from "./test-fixtures";

const timed = (id: string, start: string, end: string, over = {}) =>
  makeItem({ id, allDay: false, scheduledStart: start, start, dueAt: end, end, ...over });

describe("overlaps", () => {
  it("touching ends do not overlap; any shared minute does", () => {
    expect(overlaps({ start: "2026-09-29T13:00:00.000Z", end: "2026-09-29T14:00:00.000Z" }, { start: "2026-09-29T14:00:00.000Z", end: "2026-09-29T15:00:00.000Z" })).toBe(false);
    expect(overlaps({ start: "2026-09-29T13:00:00.000Z", end: "2026-09-29T14:01:00.000Z" }, { start: "2026-09-29T14:00:00.000Z", end: "2026-09-29T15:00:00.000Z" })).toBe(true);
  });
});

describe("findConflicts", () => {
  const a = timed("a", "2026-09-29T13:00:00.000Z", "2026-09-29T16:00:00.000Z");
  it("same person, both timed, windows touch → conflict, sorted by start", () => {
    const later = timed("b", "2026-09-29T15:00:00.000Z", "2026-09-29T17:00:00.000Z");
    const earlier = timed("c", "2026-09-29T12:00:00.000Z", "2026-09-29T13:30:00.000Z");
    expect(findConflicts(a, [later, earlier]).map((i) => i.id)).toEqual(["c", "b"]);
  });
  it("all-day, unassigned, closed and self never conflict", () => {
    const allDay = makeItem({ id: "d" });
    const nobody = timed("e", "2026-09-29T13:00:00.000Z", "2026-09-29T14:00:00.000Z", { assignedUserId: null, assignedTo: null });
    const done = timed("f", "2026-09-29T13:00:00.000Z", "2026-09-29T14:00:00.000Z", { status: "COMPLETED" });
    const other = timed("g", "2026-09-29T13:00:00.000Z", "2026-09-29T14:00:00.000Z", { assignedUserId: "u-frank" });
    expect(findConflicts(a, [allDay, nobody, done, other, a])).toEqual([]);
    expect(findConflicts(allDay, [a])).toEqual([]);
  });
  it("a span shown on several days is reported once", () => {
    const twice = timed("h", "2026-09-29T14:00:00.000Z", "2026-09-29T15:00:00.000Z");
    expect(findConflicts(a, [twice, twice])).toHaveLength(1);
  });
});

describe("describeConflict", () => {
  it("names the person and the window", () => {
    const other = timed("b", "2026-09-29T13:00:00.000Z", "2026-09-29T16:00:00.000Z");
    const text = describeConflict(other, { id: "u-lisette", firstName: "Lisette", lastName: "Perez" });
    expect(text).toMatch(/^Lisette already has “Roof tear-off” /);
    expect(describeConflict(other, null)).toMatch(/^They already have /);
  });
});
