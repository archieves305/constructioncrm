import { describe, expect, it } from "vitest";
import { addDays, defaultPeriod, parseWindow, periodsIn, windowFor } from "./windows";

describe("windowFor", () => {
  it("rolling windows end today and count today", () => {
    expect(windowFor("30d", "2026-10-13")).toMatchObject({ from: "2026-09-14", to: "2026-10-13" });
    expect(windowFor("90d", "2026-10-13")).toMatchObject({ from: "2026-07-16", to: "2026-10-13" });
    expect(windowFor("12m", "2026-10-13")).toMatchObject({ from: "2025-10-14", to: "2026-10-13" });
  });
  it("calendar month, quarter, year to date, year and last year", () => {
    expect(windowFor("month", "2026-02-10")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(windowFor("month", "2028-02-10")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(windowFor("quarter", "2026-11-03")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(windowFor("quarter", "2026-01-01")).toMatchObject({ from: "2026-01-01", to: "2026-03-31" });
    expect(windowFor("ytd", "2026-10-13")).toMatchObject({ from: "2026-01-01", to: "2026-10-13" });
    expect(windowFor("year", "2026-10-13")).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
    expect(windowFor("last-year", "2026-01-01")).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("custom needs both dates and orders them", () => {
    expect(() => windowFor("custom", "2026-10-13")).toThrow();
    expect(windowFor("custom", "2026-10-13", "2026-03-31", "2026-03-01")).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
  });
  it("addDays crosses DST and year ends on day keys", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("parseWindow falls back on a bad preset or a half custom window", () => {
    expect(parseWindow(new URLSearchParams("preset=nope"), "2026-10-13").preset).toBe("12m");
    expect(parseWindow(new URLSearchParams("preset=custom&from=2026-01-01"), "2026-10-13").preset).toBe("12m");
    expect(parseWindow(new URLSearchParams("preset=custom&from=2026-01-01&to=2026-02-01"), "2026-10-13")).toMatchObject({ from: "2026-01-01", to: "2026-02-01" });
  });
});

describe("periodsIn", () => {
  it("months clipped to the window", () => {
    const p = periodsIn({ from: "2026-01-15", to: "2026-03-10" }, "month");
    expect(p.map((x) => [x.from, x.to])).toEqual([["2026-01-15", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-10"]]);
  });
  it("weeks start on Monday", () => {
    const p = periodsIn({ from: "2026-10-01", to: "2026-10-13" }, "week");
    expect(p[0]).toMatchObject({ key: "2026-09-28", from: "2026-10-01", to: "2026-10-04" });
    expect(p[p.length - 1]).toMatchObject({ key: "2026-10-12", to: "2026-10-13" });
  });
  it("quarters and years across a year end", () => {
    expect(periodsIn({ from: "2025-11-01", to: "2026-02-01" }, "quarter").map((x) => x.label)).toEqual(["2025 Q4", "2026 Q1"]);
    expect(periodsIn({ from: "2025-06-01", to: "2026-02-01" }, "year").map((x) => x.label)).toEqual(["2025", "2026"]);
  });
  it("default period by length", () => {
    expect(defaultPeriod({ from: "2026-09-14", to: "2026-10-13" })).toBe("week");
    expect(defaultPeriod({ from: "2025-10-14", to: "2026-10-13" })).toBe("month");
    expect(defaultPeriod({ from: "2024-01-01", to: "2026-10-13" })).toBe("quarter");
  });
});
