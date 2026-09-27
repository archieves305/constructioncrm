import { describe, expect, it } from "vitest";
import { bandOf, dayTone, formatTimeRange, groupByBand, itemsByDay, sortDayItems, summarizeCalendarItems } from "./agenda";
import type { CalendarItem } from "./types";

function item(over: Partial<CalendarItem> & { id: string }): CalendarItem {
  return {
    kind: "task",
    title: over.id,
    description: null,
    status: "PENDING",
    priority: "MEDIUM",
    derived: "not_started",
    allDay: true,
    start: "2026-09-30T12:00:00.000Z",
    end: "2026-09-30T12:00:00.000Z",
    dayKey: "2026-09-30",
    startDayKey: "2026-09-30",
    dueAt: "2026-09-30T12:00:00.000Z",
    scheduledStart: null,
    completedAt: null,
    assignedUserId: null,
    createdByUserId: "u9",
    assignedTo: null,
    job: null,
    lead: null,
    violationCase: null,
    blocking: false,
    blockedReason: null,
    dueLocked: false,
    workflowTaskKey: null,
    workflowModuleKey: null,
    workflowPhaseKey: null,
    checklist: { done: 0, total: 0 },
    counts: { notes: 0, files: 0, waitingOn: 0 },
    ...over,
  };
}

const week = { from: "2026-09-28", to: "2026-10-04" };

describe("itemsByDay", () => {
  it("has every day of the range, places single items once and spans on each covered day, clipped", () => {
    const single = item({ id: "single" });
    const span = item({ id: "span", startDayKey: "2026-09-26", dayKey: "2026-10-01" });
    const outside = item({ id: "outside", dayKey: "2026-10-10", startDayKey: "2026-10-10" });
    const undated = item({ id: "undated", dayKey: null, startDayKey: null });
    const m = itemsByDay([single, span, outside, undated], week);
    expect([...m.keys()]).toHaveLength(7);
    expect(m.get("2026-09-30")!.map((i) => i.id)).toEqual(["span", "single"]);
    expect(m.get("2026-09-28")!.map((i) => i.id)).toEqual(["span"]);
    expect(m.get("2026-10-01")!.map((i) => i.id)).toEqual(["span"]);
    expect(m.get("2026-10-02")).toEqual([]);
  });
});

describe("sortDayItems", () => {
  it("open before closed, all-day before timed, timed by start, all-day by priority then title", () => {
    const done = item({ id: "done", status: "COMPLETED", priority: "URGENT" });
    const late = item({ id: "late", allDay: false, start: "2026-09-30T18:00:00.000Z" });
    const early = item({ id: "early", allDay: false, start: "2026-09-30T13:00:00.000Z" });
    const low = item({ id: "b-low", priority: "LOW" });
    const high = item({ id: "a-high", priority: "HIGH" });
    const alsoLow = item({ id: "a-low", priority: "LOW" });
    expect(sortDayItems([done, late, early, low, high, alsoLow]).map((i) => i.id)).toEqual(["a-high", "a-low", "b-low", "early", "late", "done"]);
  });
});

describe("summarizeCalendarItems / dayTone", () => {
  it("counts distinct items and picks the worst state", () => {
    const items = [
      item({ id: "a", derived: "overdue" }),
      item({ id: "a", derived: "overdue" }), // the same span on a second day
      item({ id: "b", status: "BLOCKED", derived: "blocked" }),
      item({ id: "c", status: "COMPLETED", derived: "completed" }),
      item({ id: "d", status: "CANCELLED", derived: "cancelled" }),
    ];
    expect(summarizeCalendarItems(items)).toEqual({ total: 4, done: 1, remaining: 2, overdue: 1, blocked: 1 });
    expect(dayTone(items)).toBe("overdue");
    expect(dayTone([items[2]])).toBe("blocked");
    expect(dayTone([items[3]])).toBe("quiet");
    expect(dayTone([item({ id: "x" })])).toBe("busy");
    expect(dayTone([])).toBe("empty");
  });
});

describe("bands", () => {
  it("places timed items by their ET start hour and all-day items in All day", () => {
    const TZ = "America/New_York";
    expect(bandOf(item({ id: "a" }), TZ)).toBe("allDay");
    expect(bandOf(item({ id: "m", allDay: false, start: "2026-09-30T13:00:00.000Z" }), TZ)).toBe("morning"); // 9:00 ET
    expect(bandOf(item({ id: "p", allDay: false, start: "2026-09-30T17:00:00.000Z" }), TZ)).toBe("afternoon"); // 1:00 PM ET
    expect(bandOf(item({ id: "e", allDay: false, start: "2026-09-30T22:00:00.000Z" }), TZ)).toBe("evening"); // 6:00 PM ET
    const g = groupByBand([item({ id: "a" }), item({ id: "m", allDay: false, start: "2026-09-30T13:00:00.000Z" })], TZ);
    expect(g.allDay.map((i) => i.id)).toEqual(["a"]);
    expect(g.morning.map((i) => i.id)).toEqual(["m"]);
  });
});

describe("formatTimeRange", () => {
  it("drops the first meridiem when both sides share it", () => {
    // Formatted in the test runner's local zone, so only the shape is asserted.
    const same = formatTimeRange("2026-09-30T13:00:00.000Z", "2026-09-30T15:30:00.000Z");
    expect(same).toMatch(/^\d{1,2}:\d{2} – \d{1,2}:\d{2} [AP]M$/);
  });
});
