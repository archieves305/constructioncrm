import { describe, expect, it } from "vitest";
import {
  allocateWeeklyOvertime,
  computeEntryCost,
  computeOtRate,
  computeShiftMinutes,
  minutesToHours,
  type OtSettings,
} from "./hours";

const FLSA: OtSettings = {
  otWeeklyThreshold: 40,
  otDailyThreshold: null,
  otMultiplier: 1.5,
};

describe("computeShiftMinutes", () => {
  it("computes a standard shift net of break", () => {
    // 7:00–15:30 with 30 min break = 8h
    expect(
      computeShiftMinutes({ startMinutes: 420, endMinutes: 930, breakMinutes: 30 }),
    ).toBe(480);
  });

  it("handles midnight-crossing shifts (end < start)", () => {
    // 22:00–02:00 = 4h
    expect(
      computeShiftMinutes({ startMinutes: 1320, endMinutes: 120, breakMinutes: 0 }),
    ).toBe(240);
  });

  it("handles explicit next-day endMinutes > 1440", () => {
    // 22:00 → 26:00 (2:00 AM next day)
    expect(
      computeShiftMinutes({ startMinutes: 1320, endMinutes: 1560, breakMinutes: 0 }),
    ).toBe(240);
  });

  it("returns 0 for missing times, and floors at 0 for oversized breaks", () => {
    expect(computeShiftMinutes({ startMinutes: null, endMinutes: 930, breakMinutes: 0 })).toBe(0);
    expect(computeShiftMinutes({ startMinutes: 420, endMinutes: null, breakMinutes: 0 })).toBe(0);
    expect(computeShiftMinutes({ startMinutes: 420, endMinutes: 450, breakMinutes: 60 })).toBe(0);
    expect(computeShiftMinutes({ startMinutes: 420, endMinutes: 930, breakMinutes: -10 })).toBe(510);
  });
});

describe("allocateWeeklyOvertime — weekly threshold", () => {
  const day = (n: number) => `2026-06-${String(29 + n).padStart(2, "0")}`; // Mon +n

  it("exactly 40h across five days → zero OT", () => {
    const entries = [0, 1, 2, 3, 4].map((i) => ({
      id: `e${i}`,
      workDate: day(i),
      minutes: 480,
    }));
    const out = allocateWeeklyOvertime(entries, FLSA);
    for (const e of entries) {
      expect(out.get(e.id)).toEqual({ regularHours: 8, otHours: 0, totalHours: 8 });
    }
  });

  it("spills past-40 hours into OT on the later entries", () => {
    // 5 × 9h = 45h → last day: 4h regular + 5h OT? No: cumulative fills
    // Mon–Thu 36h, Fri 9h → 4h regular + 5h OT.
    const entries = [0, 1, 2, 3, 4].map((i) => ({
      id: `e${i}`,
      workDate: day(i),
      minutes: 540,
    }));
    const out = allocateWeeklyOvertime(entries, FLSA);
    expect(out.get("e3")).toEqual({ regularHours: 9, otHours: 0, totalHours: 9 });
    expect(out.get("e4")).toEqual({ regularHours: 4, otHours: 5, totalHours: 9 });
  });

  it("straddling entry splits regular/OT within the same entry", () => {
    const entries = [
      { id: "a", workDate: day(0), minutes: 38 * 60 },
      { id: "b", workDate: day(1), minutes: 6 * 60 },
    ];
    const out = allocateWeeklyOvertime(entries, FLSA);
    expect(out.get("b")).toEqual({ regularHours: 2, otHours: 4, totalHours: 6 });
  });

  it("multi-job same week: allocation is chronological across all entries", () => {
    // Same worker, two jobs: job A Mon–Wed 30h, job B Thu–Fri 16h → 6h OT on Friday
    const entries = [
      { id: "a-mon", workDate: day(0), minutes: 600 },
      { id: "a-tue", workDate: day(1), minutes: 600 },
      { id: "a-wed", workDate: day(2), minutes: 600 },
      { id: "b-thu", workDate: day(3), minutes: 480 },
      { id: "b-fri", workDate: day(4), minutes: 480 },
    ];
    const out = allocateWeeklyOvertime(entries, FLSA);
    expect(out.get("b-thu")).toEqual({ regularHours: 8, otHours: 0, totalHours: 8 });
    expect(out.get("b-fri")).toEqual({ regularHours: 2, otHours: 6, totalHours: 8 });
  });

  it("same-day split shifts allocate stably by id", () => {
    const entries = [
      { id: "z-second", workDate: day(0), minutes: 39 * 60 },
      { id: "a-first", workDate: day(0), minutes: 4 * 60 },
    ];
    const out = allocateWeeklyOvertime(entries, FLSA);
    // a-first sorts before z-second; z-second exceeds the weekly cap by 3h
    expect(out.get("a-first")).toEqual({ regularHours: 4, otHours: 0, totalHours: 4 });
    expect(out.get("z-second")).toEqual({ regularHours: 36, otHours: 3, totalHours: 39 });
  });
});

describe("allocateWeeklyOvertime — daily threshold interaction", () => {
  const settings: OtSettings = {
    otWeeklyThreshold: 40,
    otDailyThreshold: 8,
    otMultiplier: 1.5,
  };

  it("past-8h day is OT even when the week stays under 40", () => {
    const entries = [
      { id: "mon", workDate: "2026-06-29", minutes: 10 * 60 },
      { id: "tue", workDate: "2026-06-30", minutes: 6 * 60 },
    ];
    const out = allocateWeeklyOvertime(entries, settings);
    expect(out.get("mon")).toEqual({ regularHours: 8, otHours: 2, totalHours: 10 });
    expect(out.get("tue")).toEqual({ regularHours: 6, otHours: 0, totalHours: 6 });
  });

  it("daily OT does not consume the weekly regular budget", () => {
    // 5 × 10h days: 2h/day daily-OT; day-regular totals 40h = exactly the cap
    const entries = [0, 1, 2, 3, 4].map((i) => ({
      id: `e${i}`,
      workDate: `2026-06-${29 + i}`,
      minutes: 600,
    }));
    const out = allocateWeeklyOvertime(entries, settings);
    expect(out.get("e4")).toEqual({ regularHours: 8, otHours: 2, totalHours: 10 });
  });

  it("split shifts share one day's daily threshold", () => {
    const entries = [
      { id: "a", workDate: "2026-06-29", minutes: 6 * 60 },
      { id: "b", workDate: "2026-06-29", minutes: 4 * 60 },
    ];
    const out = allocateWeeklyOvertime(entries, settings);
    expect(out.get("a")).toEqual({ regularHours: 6, otHours: 0, totalHours: 6 });
    expect(out.get("b")).toEqual({ regularHours: 2, otHours: 2, totalHours: 4 });
  });
});

describe("rounding and cost", () => {
  it("minutesToHours rounds to 2dp", () => {
    expect(minutesToHours(500)).toBe(8.33);
    expect(minutesToHours(50)).toBe(0.83);
    expect(minutesToHours(0)).toBe(0);
  });

  it("computeOtRate", () => {
    expect(computeOtRate(32.5, 1.5)).toBe(48.75);
    expect(computeOtRate(33.33, 1.5)).toBe(50);
  });

  it("computeEntryCost rounds once at the end", () => {
    expect(
      computeEntryCost({ regularHours: 8, otHours: 2, regularRate: 32.5, otRate: 48.75 }),
    ).toBe(357.5);
    expect(
      computeEntryCost({ regularHours: 8.33, otHours: 0, regularRate: 30, otRate: 45 }),
    ).toBe(249.9);
  });
});
