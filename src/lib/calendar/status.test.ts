import { describe, expect, it } from "vitest";
import { deriveCalendarStatus, isOverdue, overdueWhere } from "./status";

const TZ = "America/New_York";
const pin = new Date("2026-09-28T12:00:00.000Z"); // Mon 2026-09-28, all-day pin

describe("isOverdue — all-day", () => {
  it("is not late during its day, even at 8:01 ET when dueAt < now", () => {
    const eightAm = new Date("2026-09-28T12:01:00.000Z");
    expect(isOverdue({ dueAt: pin, allDay: true, status: "PENDING" }, eightAm, TZ)).toBe(false);
  });
  it("is not late at 23:00 ET on its day", () => {
    expect(isOverdue({ dueAt: pin, allDay: true, status: "PENDING" }, new Date("2026-09-29T03:00:00.000Z"), TZ)).toBe(false);
  });
  it("is late at 00:01 ET the next day", () => {
    expect(isOverdue({ dueAt: pin, allDay: true, status: "PENDING" }, new Date("2026-09-29T04:01:00.000Z"), TZ)).toBe(true);
  });
  it("reads the engine's 17:00Z pin as the same day", () => {
    const engine = new Date("2026-09-28T17:00:00.000Z");
    expect(isOverdue({ dueAt: engine, allDay: true, status: "PENDING" }, new Date("2026-09-29T03:00:00.000Z"), TZ)).toBe(false);
    expect(isOverdue({ dueAt: engine, allDay: true, status: "PENDING" }, new Date("2026-09-29T04:01:00.000Z"), TZ)).toBe(true);
  });
  it("treats a missing flag as all-day (pre-calendar rows)", () => {
    expect(isOverdue({ dueAt: pin, status: "PENDING" }, new Date("2026-09-28T12:01:00.000Z"), TZ)).toBe(false);
  });
});

describe("isOverdue — timed", () => {
  const end = new Date("2026-09-29T15:30:00.000Z"); // 11:30 ET
  it("is late one minute after the window ends", () => {
    expect(isOverdue({ dueAt: end, allDay: false, status: "IN_PROGRESS" }, new Date("2026-09-29T15:31:00.000Z"), TZ)).toBe(true);
    expect(isOverdue({ dueAt: end, allDay: false, status: "IN_PROGRESS" }, new Date("2026-09-29T15:29:00.000Z"), TZ)).toBe(false);
  });
});

describe("deriveCalendarStatus", () => {
  const late = new Date("2026-10-05T12:00:00.000Z");
  it("closed states win, then overdue, then blocked, in progress, not started", () => {
    expect(deriveCalendarStatus({ dueAt: pin, allDay: true, status: "COMPLETED" }, late, TZ)).toBe("completed");
    expect(deriveCalendarStatus({ dueAt: pin, allDay: true, status: "CANCELLED" }, late, TZ)).toBe("cancelled");
    expect(deriveCalendarStatus({ dueAt: pin, allDay: true, status: "BLOCKED" }, late, TZ)).toBe("overdue");
    expect(deriveCalendarStatus({ dueAt: pin, allDay: true, status: "BLOCKED" }, pin, TZ)).toBe("blocked");
    expect(deriveCalendarStatus({ dueAt: pin, allDay: true, status: "IN_PROGRESS" }, pin, TZ)).toBe("in_progress");
    expect(deriveCalendarStatus({ dueAt: null, allDay: true, status: "PENDING" }, late, TZ)).toBe("not_started");
  });
});

describe("overdueWhere", () => {
  it("bounds all-day rows by the start of today in the app zone and timed rows by now", () => {
    const now = new Date("2026-09-28T14:00:00.000Z"); // 10:00 ET Monday
    expect(overdueWhere(now, TZ)).toEqual({
      OR: [
        { allDay: true, dueAt: { lt: new Date("2026-09-28T04:00:00.000Z") } },
        { allDay: false, dueAt: { lt: now } },
      ],
    });
  });
});
