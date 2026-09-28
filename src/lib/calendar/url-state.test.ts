import { describe, expect, it } from "vitest";
import { activeFilterCount, rangeForView, rangeLabel, readFilters, resolveDate, resolveUsers, resolveView, shiftAnchor } from "./url-state";

describe("resolveView", () => {
  it("URL wins, then a phone is a day, then the preference, then week", () => {
    expect(resolveView({ url: "month", pref: "DAY", isPhone: true })).toBe("month");
    expect(resolveView({ url: "people", pref: "DAY", isPhone: false })).toBe("people");
    expect(resolveView({ url: "people", pref: "DAY", isPhone: true })).toBe("day");
    expect(resolveView({ url: null, pref: "MONTH", isPhone: true })).toBe("day");
    expect(resolveView({ url: null, pref: "MONTH", isPhone: false })).toBe("month");
    expect(resolveView({ url: null, pref: null, isPhone: false })).toBe("week");
  });
});

describe("resolveDate / resolveUsers", () => {
  it("falls back to today on junk", () => {
    expect(resolveDate("2026-09-28", "2026-10-01")).toBe("2026-09-28");
    expect(resolveDate("2026-13-40", "2026-10-01")).toBe("2026-10-01");
    expect(resolveDate(null, "2026-10-01")).toBe("2026-10-01");
  });
  it("own-only roles are always me; view-all roles follow URL then the list preference", () => {
    expect(resolveUsers({ url: "all", pref: "ALL", role: "SALES_REP" })).toBe("me");
    expect(resolveUsers({ url: "all", pref: "ALL", role: "MARKETING" })).toBe("me");
    expect(resolveUsers({ url: "u2,u3", pref: "MINE", role: "ADMIN" })).toBe("u2,u3");
    expect(resolveUsers({ url: null, pref: "ALL", role: "ADMIN" })).toBe("all");
    expect(resolveUsers({ url: null, pref: "MINE", role: "READ_ONLY" })).toBe("me");
    expect(resolveUsers({ url: "all", pref: null, role: null })).toBe("me");
  });
});

describe("rangeForView / shiftAnchor", () => {
  it("day is one day, week is Mon–Sun, month is the 42-day grid", () => {
    expect(rangeForView("day", "2026-09-30")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(rangeForView("week", "2026-09-30")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(rangeForView("month", "2026-10-15")).toEqual({ from: "2026-09-28", to: "2026-11-08" });
  });
  it("moves by a day, a week, or to the first of the adjacent month", () => {
    expect(shiftAnchor("day", "2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftAnchor("week", "2026-09-30", -1)).toBe("2026-09-23");
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftAnchor("month", "2026-01-31", -1)).toBe("2025-12-01");
  });
});

describe("rangeLabel", () => {
  it("reads naturally for each view", () => {
    expect(rangeLabel("day", "2026-09-28")).toBe("Monday, September 28, 2026");
    expect(rangeLabel("month", "2026-10-15")).toBe("October 2026");
    expect(rangeLabel("week", "2026-09-30")).toBe("Sep 28 – Oct 4, 2026");
    expect(rangeLabel("week", "2026-09-16")).toBe("Sep 14 – 20, 2026");
    expect(rangeLabel("week", "2026-12-30")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("filters", () => {
  it("reads and counts", () => {
    const sp = new URLSearchParams("job=j1&q=%20roof%20&completed=0&status=");
    const f = readFilters((k) => sp.get(k));
    expect(f).toEqual({ job: "j1", status: undefined, priority: undefined, q: "roof", hideCompleted: true });
    expect(activeFilterCount(f)).toBe(3);
    expect(activeFilterCount(readFilters(() => null))).toBe(0);
  });
});
