import { describe, expect, it } from "vitest";
import { parseDueAt } from "@/lib/tasks/dates";
import {
  addDayKeys,
  addLocalDays,
  atLocalTime,
  dayKey,
  dayKeysBetween,
  diffDayKeys,
  endOfDayIn,
  isDayKey,
  monthRange,
  pinAllDay,
  startOfDayIn,
  weekRange,
  weekdayOf,
} from "./zone";

const TZ = "America/New_York";

describe("dayKey", () => {
  it("reads the noon-UTC pin, the engine's 17:00Z and a late-evening ET instant as the right ET day", () => {
    expect(dayKey(new Date("2026-09-28T12:00:00.000Z"), TZ)).toBe("2026-09-28");
    expect(dayKey(new Date("2026-09-28T17:00:00.000Z"), TZ)).toBe("2026-09-28");
    // 03:30Z is 23:30 the previous evening in EDT.
    expect(dayKey(new Date("2026-09-29T03:30:00.000Z"), TZ)).toBe("2026-09-28");
    // 04:30Z in December is 23:30 EST the previous evening.
    expect(dayKey(new Date("2026-12-10T04:30:00.000Z"), TZ)).toBe("2026-12-09");
  });
});

describe("startOfDayIn / endOfDayIn", () => {
  it("bounds a day in EDT (UTC-4)", () => {
    expect(startOfDayIn("2026-09-27", TZ).toISOString()).toBe("2026-09-27T04:00:00.000Z");
    expect(endOfDayIn("2026-09-27", TZ).toISOString()).toBe("2026-09-28T03:59:59.999Z");
  });
  it("bounds a day in EST (UTC-5)", () => {
    expect(startOfDayIn("2026-12-10", TZ).toISOString()).toBe("2026-12-10T05:00:00.000Z");
    expect(endOfDayIn("2026-12-10", TZ).toISOString()).toBe("2026-12-11T04:59:59.999Z");
  });
  it("atLocalTime places a clock time on the day", () => {
    expect(atLocalTime("2026-09-28", 9, 0, TZ).toISOString()).toBe("2026-09-28T13:00:00.000Z");
  });
});

describe("weekRange", () => {
  it("is Monday to Sunday around a Wednesday, a Sunday and a Monday", () => {
    expect(weekRange("2026-09-30")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(weekRange("2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(weekRange("2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });
  it("honours a Sunday start when asked", () => {
    expect(weekRange("2026-09-30", 0)).toEqual({ from: "2026-09-27", to: "2026-10-03" });
  });
});

describe("monthRange", () => {
  it("is a 42-day grid starting on the Monday of the week holding the 1st", () => {
    const g = monthRange("2026-10-15");
    expect(g.monthStart).toBe("2026-10-01");
    expect(g.monthEnd).toBe("2026-10-31");
    expect(g.from).toBe("2026-09-28");
    expect(g.to).toBe("2026-11-08");
    expect(dayKeysBetween(g.from, g.to)).toHaveLength(42);
  });
  it("handles February and year end", () => {
    expect(monthRange("2028-02-10").monthEnd).toBe("2028-02-29");
    expect(monthRange("2026-12-31").from).toBe("2026-11-30");
  });
});

describe("addLocalDays", () => {
  it("keeps 9:00 ET across the spring-forward and fall-back weekends", () => {
    // 2026-03-07 09:00 EST = 14:00Z; the next day is EDT so 09:00 = 13:00Z.
    expect(addLocalDays(new Date("2026-03-07T14:00:00.000Z"), 1, TZ).toISOString()).toBe("2026-03-08T13:00:00.000Z");
    // 2026-10-31 09:00 EDT = 13:00Z; Nov 1 is EST so 09:00 = 14:00Z.
    expect(addLocalDays(new Date("2026-10-31T13:00:00.000Z"), 1, TZ).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
  it("moves backwards too", () => {
    expect(addLocalDays(new Date("2026-09-30T13:00:00.000Z"), -3, TZ).toISOString()).toBe("2026-09-27T13:00:00.000Z");
  });
});

describe("day-key arithmetic", () => {
  it("adds and diffs across month and year boundaries", () => {
    expect(addDayKeys("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDayKeys("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDayKeys("2026-09-28", "2026-10-04")).toBe(6);
    expect(diffDayKeys("2026-10-04", "2026-09-28")).toBe(-6);
  });
  it("knows weekdays", () => {
    expect(weekdayOf("2026-09-27")).toBe(0); // Sunday
    expect(weekdayOf("2026-09-28")).toBe(1); // Monday
  });
  it("validates keys strictly", () => {
    expect(isDayKey("2026-09-28")).toBe(true);
    expect(isDayKey("2026-13-40")).toBe(false);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("28/09/2026")).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});

describe("pinAllDay", () => {
  it("is the same noon-UTC pin parseDueAt has always applied", () => {
    expect(pinAllDay("2026-09-28").getTime()).toBe(parseDueAt("2026-09-28").getTime());
    expect(dayKey(pinAllDay("2026-09-28"), TZ)).toBe("2026-09-28");
  });
});
