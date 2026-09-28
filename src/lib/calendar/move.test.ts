import { describe, expect, it } from "vitest";
import { applyMove, canDrag, canMove, dependencyWarning, describeMove, describeTarget, movePatch } from "./move";
import { makeItem, PEOPLE } from "./test-fixtures";

const admin = { id: "u-richard", role: "ADMIN" as const };
const rep = { id: "u-lisette", role: "SALES_REP" as const };
const reader = { id: "u-read", role: "READ_ONLY" as const };

describe("movePatch", () => {
  it("a day drop is a bare day key — the server carries the window along", () => {
    expect(movePatch(makeItem(), { kind: "day", day: "2026-10-01" })).toEqual({ dueAt: "2026-10-01" });
  });

  it("dropping a card on the day it is already on is a no-op", () => {
    expect(movePatch(makeItem(), { kind: "day", day: "2026-09-29" })).toBeNull();
    expect(movePatch(makeItem(), { kind: "cell", day: "2026-09-29", userId: "u-lisette" })).toBeNull();
    expect(movePatch(makeItem({ dueAt: null, start: null, end: null, dayKey: null, startDayKey: null }), { kind: "unscheduled" })).toBeNull();
  });

  it("a slot gives an all-day task an hour at the band start (in the office zone)", () => {
    const p = movePatch(makeItem(), { kind: "slot", day: "2026-09-29", hour: 8, minute: 0 });
    // 8:00 EDT = 12:00Z
    expect(p).toEqual({ allDay: false, scheduledStart: "2026-09-29T12:00:00.000Z", dueAt: "2026-09-29T13:00:00.000Z" });
  });

  it("a slot keeps a timed task's length", () => {
    const timed = makeItem({ allDay: false, scheduledStart: "2026-09-29T13:00:00.000Z", dueAt: "2026-09-29T16:00:00.000Z" });
    const p = movePatch(timed, { kind: "slot", day: "2026-09-30", hour: 13, minute: 0 });
    // 13:00 EDT = 17:00Z, three hours long
    expect(p).toEqual({ allDay: false, scheduledStart: "2026-09-30T17:00:00.000Z", dueAt: "2026-09-30T20:00:00.000Z" });
  });

  it("a cell changes only what differs", () => {
    expect(movePatch(makeItem(), { kind: "cell", day: "2026-09-29", userId: "u-frank" })).toEqual({ assignedUserId: "u-frank" });
    expect(movePatch(makeItem(), { kind: "cell", day: "2026-09-30", userId: "u-lisette" })).toEqual({ dueAt: "2026-09-30" });
    expect(movePatch(makeItem(), { kind: "cell", day: "2026-09-30", userId: null })).toEqual({ dueAt: "2026-09-30", assignedUserId: null });
  });

  it("the rail clears the due date", () => {
    expect(movePatch(makeItem(), { kind: "unscheduled" })).toEqual({ dueAt: null });
  });
});

describe("canMove / canDrag", () => {
  const item = makeItem();
  it("closed tasks stay where they are", () => {
    expect(canDrag(admin, makeItem({ status: "COMPLETED" }))).toBe(false);
    expect(canMove(admin, makeItem({ status: "CANCELLED" }), { kind: "day", day: "2026-10-01" }, { dispatch: true })).toBe(false);
  });
  it("READ_ONLY moves nothing", () => {
    expect(canDrag(reader, item)).toBe(false);
    expect(canMove(reader, item, { kind: "day", day: "2026-10-01" }, { dispatch: false })).toBe(false);
  });
  it("an own-only role reschedules its own task but cannot hand it to someone else or take it off the calendar", () => {
    expect(canMove(rep, item, { kind: "day", day: "2026-10-01" }, { dispatch: false })).toBe(true);
    expect(canMove(rep, item, { kind: "cell", day: "2026-10-01", userId: "u-lisette" }, { dispatch: false })).toBe(true);
    expect(canMove(rep, item, { kind: "cell", day: "2026-10-01", userId: "u-frank" }, { dispatch: false })).toBe(false);
    expect(canMove(rep, item, { kind: "unscheduled" }, { dispatch: false })).toBe(false);
    expect(canMove(rep, makeItem({ assignedUserId: "u-frank" }), { kind: "day", day: "2026-10-01" }, { dispatch: false })).toBe(false);
  });
  it("overlays (inspections, hearings, job starts) never move", () => {
    const ov = makeItem({ kind: "hearing", overlay: { label: "Hearing", detail: null, href: "/violations/c1?tab=hearings", state: "scheduled" }, assignedUserId: null, assignedTo: null });
    expect(canDrag(admin, ov)).toBe(false);
    expect(canMove(admin, ov, { kind: "day", day: "2026-10-01" }, { dispatch: true })).toBe(false);
  });
  it("dispatch roles do all of it", () => {
    expect(canMove(admin, item, { kind: "cell", day: "2026-10-01", userId: null }, { dispatch: true })).toBe(true);
    expect(canMove(admin, item, { kind: "unscheduled" }, { dispatch: true })).toBe(true);
  });
});

describe("applyMove", () => {
  const now = new Date("2026-09-28T15:00:00.000Z");
  it("paints a day move the way the server will store it", () => {
    const next = applyMove(makeItem(), { dueAt: "2026-10-01" }, PEOPLE, now);
    expect(next.dueAt).toBe("2026-10-01T12:00:00.000Z");
    expect(next.dayKey).toBe("2026-10-01");
    expect(next.startDayKey).toBe("2026-10-01");
    expect(next.allDay).toBe(true);
    expect(next.derived).toBe("not_started");
  });
  it("a timed task dragged to another day keeps its clock times", () => {
    const timed = makeItem({ allDay: false, scheduledStart: "2026-09-29T13:00:00.000Z", dueAt: "2026-09-29T15:00:00.000Z" });
    const next = applyMove(timed, { dueAt: "2026-09-30" }, PEOPLE, now);
    expect(next.start).toBe("2026-09-30T13:00:00.000Z");
    expect(next.end).toBe("2026-09-30T15:00:00.000Z");
    expect(next.allDay).toBe(false);
  });
  it("swaps the assignee and the avatar together, and derives overdue from the new day", () => {
    const next = applyMove(makeItem(), { dueAt: "2026-09-20", assignedUserId: "u-frank" }, PEOPLE, now);
    expect(next.assignedUserId).toBe("u-frank");
    expect(next.assignedTo?.firstName).toBe("Frank");
    expect(next.derived).toBe("overdue");
    const un = applyMove(makeItem(), { assignedUserId: null }, PEOPLE, now);
    expect(un.assignedTo).toBeNull();
  });
  it("taking a task off the calendar clears everything date-shaped", () => {
    const next = applyMove(makeItem(), { dueAt: null }, PEOPLE, now);
    expect(next.dueAt).toBeNull();
    expect(next.dayKey).toBeNull();
    expect(next.start).toBeNull();
    expect(next.end).toBeNull();
  });
});

describe("dependencyWarning", () => {
  it("names how many earlier steps are still open, or says nothing", () => {
    expect(dependencyWarning(makeItem())).toBeNull();
    expect(dependencyWarning(makeItem({ counts: { notes: 0, files: 0, waitingOn: 1 } }))).toMatch(/waiting on an earlier step/);
    expect(dependencyWarning(makeItem({ counts: { notes: 0, files: 0, waitingOn: 3 } }))).toMatch(/waiting on 3 earlier steps/);
  });
});

describe("describeMove / describeTarget", () => {
  const item = makeItem();
  it("says what happened in the dispatcher's words", () => {
    expect(describeMove(item, { kind: "day", day: "2026-09-30" }, PEOPLE)).toBe("Moved to Wed, Sep 30");
    expect(describeMove(item, { kind: "slot", day: "2026-09-30", hour: 13, minute: 0 }, PEOPLE)).toBe("Moved to Wed, Sep 30 at 1:00 PM");
    expect(describeMove(item, { kind: "cell", day: "2026-09-30", userId: "u-lisette" }, PEOPLE)).toBe("Moved to Wed, Sep 30");
    expect(describeMove(item, { kind: "cell", day: "2026-09-30", userId: "u-frank" }, PEOPLE)).toBe("Assigned to Frank · Wed, Sep 30");
    expect(describeMove(item, { kind: "cell", day: "2026-09-30", userId: null }, PEOPLE)).toBe("Unassigned · Wed, Sep 30");
    expect(describeMove(item, { kind: "unscheduled" }, PEOPLE)).toBe("Taken off the calendar");
  });
  it("names a target for a screen reader", () => {
    expect(describeTarget({ kind: "cell", day: "2026-09-30", userId: null }, PEOPLE)).toBe("Unassigned, Wed, Sep 30");
    expect(describeTarget({ kind: "slot", day: "2026-09-30", hour: 8, minute: 0 }, PEOPLE)).toBe("Wed, Sep 30 at 8:00 AM");
  });
});
