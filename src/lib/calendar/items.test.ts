import { describe, expect, it } from "vitest";
import { toCalendarItem } from "./items";
import type { CalendarRow } from "./select";

const now = new Date("2026-09-28T14:00:00.000Z");

const base: CalendarRow = {
  id: "t1",
  title: "Order shingles",
  description: null,
  status: "PENDING",
  priority: "HIGH",
  dueAt: new Date("2026-09-30T12:00:00.000Z"),
  scheduledStart: null,
  allDay: true,
  completedAt: null,
  assignedUserId: "u1",
  createdByUserId: "u9",
  blocking: false,
  blockedReason: null,
  dueLocked: false,
  workflowTaskKey: "roofing:order_materials",
  workflowModuleKey: "roofing",
  workflowPhaseKey: "roofing:procurement",
  checklist: [{ key: "a", label: "A", done: true }, { key: "b", label: "B", done: false }],
  assignedTo: { id: "u1", firstName: "Lisette", lastName: "V" },
  job: null,
  lead: null,
  violationCase: null,
  _count: { events: 3, files: 0, dependencies: 2 },
};

describe("toCalendarItem", () => {
  it("normalises an all-day task: start = end = the due pin, one day key", () => {
    const it_ = toCalendarItem(base, now);
    expect(it_.kind).toBe("task");
    expect(it_.start).toBe("2026-09-30T12:00:00.000Z");
    expect(it_.end).toBe("2026-09-30T12:00:00.000Z");
    expect(it_.dayKey).toBe("2026-09-30");
    expect(it_.startDayKey).toBe("2026-09-30");
    expect(it_.allDay).toBe(true);
    expect(it_.derived).toBe("not_started");
    expect(it_.checklist).toEqual({ done: 1, total: 2 });
    expect(it_.counts).toEqual({ notes: 3, files: 0, waitingOn: 2 });
  });

  it("normalises a timed task and a span", () => {
    const timed = toCalendarItem(
      { ...base, allDay: false, scheduledStart: new Date("2026-09-30T13:00:00.000Z"), dueAt: new Date("2026-09-30T15:30:00.000Z") },
      now,
    );
    expect(timed.start).toBe("2026-09-30T13:00:00.000Z");
    expect(timed.end).toBe("2026-09-30T15:30:00.000Z");
    expect(timed.dayKey).toBe("2026-09-30");

    const span = toCalendarItem({ ...base, scheduledStart: new Date("2026-09-28T12:00:00.000Z") }, now);
    expect(span.startDayKey).toBe("2026-09-28");
    expect(span.dayKey).toBe("2026-09-30");
  });

  it("an unscheduled task has no keys and an empty checklist reads 0/0", () => {
    const u = toCalendarItem({ ...base, dueAt: null, checklist: null }, now);
    expect(u.start).toBeNull();
    expect(u.end).toBeNull();
    expect(u.dayKey).toBeNull();
    expect(u.checklist).toEqual({ done: 0, total: 0 });
  });

  it("derives overdue from the office day", () => {
    const late = toCalendarItem({ ...base, dueAt: new Date("2026-09-25T12:00:00.000Z") }, now);
    expect(late.derived).toBe("overdue");
  });
});
