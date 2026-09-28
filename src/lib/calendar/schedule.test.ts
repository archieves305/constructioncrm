import { describe, expect, it } from "vitest";
import { applySchedule, EMPTY_SCHEDULE, type ScheduleFields } from "./schedule";

const iso = (s: string) => new Date(s).toISOString();

const allDayMon: ScheduleFields = { dueAt: new Date("2026-09-28T12:00:00.000Z"), scheduledStart: null, allDay: true };
// 9:00–11:30 ET on Tue 2026-09-29 (EDT = UTC-4).
const timedTue: ScheduleFields = {
  dueAt: new Date("2026-09-29T15:30:00.000Z"),
  scheduledStart: new Date("2026-09-29T13:00:00.000Z"),
  allDay: false,
};
// Mon–Wed span.
const spanMonWed: ScheduleFields = {
  dueAt: new Date("2026-09-30T12:00:00.000Z"),
  scheduledStart: new Date("2026-09-28T12:00:00.000Z"),
  allDay: true,
};
// Engine-pinned 17:00Z all-day.
const engineMon: ScheduleFields = { dueAt: new Date("2026-09-28T17:00:00.000Z"), scheduledStart: null, allDay: true };

function ok(r: ReturnType<typeof applySchedule>) {
  if (!r.ok) throw new Error(`expected ok, got ${r.field}: ${r.error}`);
  return r;
}

describe("applySchedule — untouched and cleared", () => {
  it("returns the existing fields when the patch says nothing about the schedule", () => {
    const r = ok(applySchedule(timedTue, {}));
    expect(r.next).toEqual(timedTue);
    expect(r.dueChanged).toBe(false);
    expect(r.windowChanged).toBe(false);
  });
  it("dueAt: null clears the whole window", () => {
    const r = ok(applySchedule(timedTue, { dueAt: null }));
    expect(r.next).toEqual(EMPTY_SCHEDULE);
    expect(r.dueChanged).toBe(true);
    expect(r.dayChanged).toBe(true);
    expect(r.windowChanged).toBe(true);
  });
  it("refuses a start with no due date", () => {
    const r = applySchedule(EMPTY_SCHEDULE, { dueAt: null, scheduledStart: "2026-09-29T13:00:00.000Z" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.field).toBe("dueAt");
  });
});

describe("applySchedule — a day key", () => {
  it("pins a plain all-day task to noon UTC, exactly as before", () => {
    const r = ok(applySchedule(allDayMon, { dueAt: "2026-10-01" }));
    expect(r.next).toEqual({ dueAt: new Date("2026-10-01T12:00:00.000Z"), scheduledStart: null, allDay: true });
    expect(r.dayChanged).toBe(true);
    expect(r.windowChanged).toBe(false);
  });
  it("schedules an unscheduled task onto a day", () => {
    const r = ok(applySchedule(EMPTY_SCHEDULE, { dueAt: "2026-10-01" }));
    expect(r.next.dueAt?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(r.next.allDay).toBe(true);
  });
  it("moves a timed task to another day keeping its clock times", () => {
    const r = ok(applySchedule(timedTue, { dueAt: "2026-10-01" }));
    expect(iso(r.next.scheduledStart!.toISOString())).toBe("2026-10-01T13:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-10-01T15:30:00.000Z");
    expect(r.next.allDay).toBe(false);
    expect(r.dayChanged).toBe(true);
  });
  it("keeps 9:00 ET when a timed task crosses the fall-back weekend", () => {
    // Fri 2026-10-30 09:00 EDT = 13:00Z → Mon 2026-11-02 09:00 EST = 14:00Z.
    const fri: ScheduleFields = {
      dueAt: new Date("2026-10-30T14:00:00.000Z"),
      scheduledStart: new Date("2026-10-30T13:00:00.000Z"),
      allDay: false,
    };
    const r = ok(applySchedule(fri, { dueAt: "2026-11-02" }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
  it("moves a span keeping its length", () => {
    const r = ok(applySchedule(spanMonWed, { dueAt: "2026-10-07" }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(r.next.allDay).toBe(true);
  });
  it("a day key plus allDay:true drops a timed task's times", () => {
    const r = ok(applySchedule(timedTue, { dueAt: "2026-09-29", allDay: true }));
    expect(r.next).toEqual({ dueAt: new Date("2026-09-29T12:00:00.000Z"), scheduledStart: null, allDay: true });
    expect(r.windowChanged).toBe(true);
  });
  it("a day key plus allDay:false with no time gives the default 9:00–10:00 ET slot", () => {
    const r = ok(applySchedule(allDayMon, { dueAt: "2026-09-28", allDay: false }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-09-28T13:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-09-28T14:00:00.000Z");
    expect(r.next.allDay).toBe(false);
  });
  it("a day key plus a start keeps the previous duration", () => {
    const r = ok(applySchedule(timedTue, { dueAt: "2026-10-02", scheduledStart: "2026-10-02T18:00:00.000Z", allDay: false }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-10-02T18:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-10-02T20:30:00.000Z");
  });
  it("a day key with an earlier start day makes a span", () => {
    const r = ok(applySchedule(allDayMon, { dueAt: "2026-10-02", scheduledStart: "2026-09-30" }));
    expect(r.next).toEqual({
      dueAt: new Date("2026-10-02T12:00:00.000Z"),
      scheduledStart: new Date("2026-09-30T12:00:00.000Z"),
      allDay: true,
    });
  });
});

describe("applySchedule — an ISO end", () => {
  it("sets a timed window exactly when both instants are given", () => {
    const r = ok(applySchedule(allDayMon, { dueAt: "2026-09-28T20:00:00.000Z", scheduledStart: "2026-09-28T18:00:00.000Z", allDay: false }));
    expect(r.next).toEqual({
      dueAt: new Date("2026-09-28T20:00:00.000Z"),
      scheduledStart: new Date("2026-09-28T18:00:00.000Z"),
      allDay: false,
    });
    expect(r.dayChanged).toBe(false);
    expect(r.dueChanged).toBe(true);
    expect(r.windowChanged).toBe(true);
  });
  it("gives a timed end with no start an hour before it", () => {
    const r = ok(applySchedule(allDayMon, { dueAt: "2026-09-28T20:00:00.000Z", allDay: false }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-09-28T19:00:00.000Z");
  });
  it("keeps the old duration when only the end moves", () => {
    const r = ok(applySchedule(timedTue, { dueAt: "2026-09-29T12:30:00.000Z" }));
    // Old start 13:00Z is after the new end, so the start follows: 2.5h earlier.
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-09-29T10:00:00.000Z");
  });
  it("rejects garbage", () => {
    expect(applySchedule(allDayMon, { dueAt: "next tuesday" }).ok).toBe(false);
  });
});

describe("applySchedule — start only", () => {
  it("moves the start and leaves the end", () => {
    const r = ok(applySchedule(timedTue, { scheduledStart: "2026-09-29T14:00:00.000Z" }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-09-29T14:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-09-29T15:30:00.000Z");
    expect(r.dueChanged).toBe(false);
    expect(r.windowChanged).toBe(true);
  });
  it("pushes the end when the start passes it, keeping the length", () => {
    const r = ok(applySchedule(timedTue, { scheduledStart: "2026-09-29T16:00:00.000Z" }));
    expect(r.next.dueAt?.toISOString()).toBe("2026-09-29T18:30:00.000Z");
    expect(r.dayChanged).toBe(false);
  });
  it("refuses to clear the start of a timed task", () => {
    const r = applySchedule(timedTue, { scheduledStart: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.field).toBe("scheduledStart");
  });
  it("needs a due date", () => {
    expect(applySchedule(EMPTY_SCHEDULE, { scheduledStart: "2026-09-29T13:00:00.000Z" }).ok).toBe(false);
  });
  it("makes an all-day span from an earlier day, and drops a same-day start", () => {
    const span = ok(applySchedule(allDayMon, { scheduledStart: "2026-09-25" }));
    expect(span.next.scheduledStart?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
    const same = ok(applySchedule(allDayMon, { scheduledStart: "2026-09-28" }));
    expect(same.next.scheduledStart).toBeNull();
  });
  it("refuses a start after the due day", () => {
    const r = applySchedule(allDayMon, { scheduledStart: "2026-09-30" });
    expect(r.ok).toBe(false);
  });
});

describe("applySchedule — the all-day flag alone", () => {
  it("allDay:false on a dated all-day task gives 9:00–10:00 ET on that day", () => {
    const r = ok(applySchedule(engineMon, { allDay: false }));
    expect(r.next.scheduledStart?.toISOString()).toBe("2026-09-28T13:00:00.000Z");
    expect(r.next.dueAt?.toISOString()).toBe("2026-09-28T14:00:00.000Z");
    expect(r.dayChanged).toBe(false);
  });
  it("allDay:true on a timed task re-pins the day and drops the time", () => {
    const r = ok(applySchedule(timedTue, { allDay: true }));
    expect(r.next).toEqual({ dueAt: new Date("2026-09-29T12:00:00.000Z"), scheduledStart: null, allDay: true });
  });
  it("needs a day first", () => {
    expect(applySchedule(EMPTY_SCHEDULE, { allDay: false }).ok).toBe(false);
  });
  it("is a no-op when the flag does not change", () => {
    const r = ok(applySchedule(engineMon, { allDay: true }));
    expect(r.next).toEqual(engineMon);
    expect(r.windowChanged).toBe(false);
  });
});

describe("applySchedule — validation", () => {
  it("refuses a timed start at or after the end", () => {
    const r = applySchedule(allDayMon, { dueAt: "2026-09-28T18:00:00.000Z", scheduledStart: "2026-09-28T18:00:00.000Z", allDay: false });
    expect(r.ok).toBe(false);
  });
  it("does not re-pin the engine's 17:00 when nothing about the day changes", () => {
    const r = ok(applySchedule(engineMon, { scheduledStart: "2026-09-25" }));
    expect(r.next.dueAt?.toISOString()).toBe("2026-09-28T17:00:00.000Z");
  });
});
