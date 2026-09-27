import { describe, expect, it } from "vitest";
import { dayBucket, dueWindow, firstWindowOn, hourBucket, nextWindow, slotOf, sortedWindows, windowStartAt, type WindowSettings } from "./windows";

const S: WindowSettings = { timeZone: "America/New_York", digestWindows: ["08:00", "12:00", "15:30", "18:00"], weekdaysOnly: true, catchUpGraceMinutes: 90 };

/** A local New York wall-clock time on 2026-10-06 (a Tuesday, EDT = UTC-4). */
const et = (hhmm: string, day = "2026-10-06") => new Date(`${day}T${hhmm}:00-04:00`);

describe("windows: keys and starts", () => {
  it("sorts, dedupes and drops malformed windows", () => {
    expect(sortedWindows(["18:00", "08:00", "8:00", "12:00", "12:00", "25:00"])).toEqual(["08:00", "12:00", "18:00"]);
  });

  it("window starts follow the wall clock across the DST change", () => {
    // 2026-11-01 is the US fall-back day: 08:00 EDT on Oct 31 is 12:00Z, 08:00 EST on Nov 2 is 13:00Z.
    expect(windowStartAt(new Date("2026-10-31T15:00:00Z"), "08:00", S.timeZone).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(windowStartAt(new Date("2026-11-02T15:00:00Z"), "08:00", S.timeZone).toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });

  it("buckets are local", () => {
    expect(hourBucket(et("09:10"), S.timeZone)).toBe("2026-10-06T09");
    expect(dayBucket(et("23:30"), S.timeZone)).toBe("2026-10-06");
  });
});

describe("dueWindow", () => {
  it("is the latest window that opened inside the grace period", () => {
    expect(dueWindow(et("12:05"), S)?.key).toBe("2026-10-06:12:00");
    expect(dueWindow(et("13:25"), S)?.key).toBe("2026-10-06:12:00");
    expect(dueWindow(et("13:35"), S)).toBeNull();
    expect(dueWindow(et("07:59"), S)).toBeNull();
    expect(dueWindow(et("18:00"), S)?.key).toBe("2026-10-06:18:00");
  });

  it("is null on a weekend when weekdays-only is on, and works when it is off", () => {
    expect(dueWindow(et("12:05", "2026-10-10"), S)).toBeNull();
    expect(dueWindow(et("12:05", "2026-10-10"), { ...S, weekdaysOnly: false })?.key).toBe("2026-10-10:12:00");
  });
});

describe("nextWindow", () => {
  it("is the next company window today, else the first of the next allowed day", () => {
    expect(nextWindow(et("12:05"), S).key).toBe("2026-10-06:15:30");
    expect(nextWindow(et("07:00"), S).key).toBe("2026-10-06:08:00");
    expect(nextWindow(et("18:30"), S).key).toBe("2026-10-07:08:00");
    // Friday evening → Monday morning.
    expect(nextWindow(et("18:30", "2026-10-09"), S).key).toBe("2026-10-12:08:00");
    // Saturday noon, weekdays only → Monday morning.
    expect(nextWindow(et("12:00", "2026-10-10"), S).key).toBe("2026-10-12:08:00");
  });

  it("honours the person's subset and falls back to all when it matches nothing", () => {
    expect(nextWindow(et("12:05"), S, ["08:00"]).key).toBe("2026-10-07:08:00");
    expect(nextWindow(et("12:05"), S, ["08:00", "18:00"]).key).toBe("2026-10-06:18:00");
    expect(nextWindow(et("12:05"), S, ["09:15"]).key).toBe("2026-10-06:15:30");
  });

  it("parks rows on 08:00 when no windows are configured at all", () => {
    expect(nextWindow(et("12:05"), { ...S, digestWindows: [] }).key).toBe("2026-10-07:08:00");
  });

  it("the first window of a day is where the morning producers aim", () => {
    expect(firstWindowOn(et("15:00"), S)?.key).toBe("2026-10-06:08:00");
  });
});

describe("slotOf", () => {
  it("names the four default windows", () => {
    expect(S.digestWindows.map((w) => slotOf(w, S.digestWindows))).toEqual(["morning", "midday", "afternoon", "evening"]);
  });
  it("copes with two or three windows", () => {
    expect(["08:00", "17:00"].map((w) => slotOf(w, ["08:00", "17:00"]))).toEqual(["morning", "evening"]);
    expect(["08:00", "12:30", "17:00"].map((w) => slotOf(w, ["08:00", "12:30", "17:00"]))).toEqual(["morning", "afternoon", "evening"]);
  });
});
