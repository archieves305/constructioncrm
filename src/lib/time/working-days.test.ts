import { describe, expect, it } from "vitest";
import { addWorkingDays, isWorkingDay, previousWorkingDay, workingDaysBetween, onOrNextWorkingDay } from "./working-days";

// 2026-10-12 is a Monday.
describe("working days", () => {
  it("knows the weekend", () => {
    expect(isWorkingDay("2026-10-12")).toBe(true);
    expect(isWorkingDay("2026-10-17")).toBe(false); // Saturday
    expect(isWorkingDay("2026-10-18")).toBe(false); // Sunday
  });

  it("previousWorkingDay skips the weekend", () => {
    expect(previousWorkingDay("2026-10-12")).toBe("2026-10-09"); // Mon → Fri
    expect(previousWorkingDay("2026-10-14")).toBe("2026-10-13");
  });

  it("addWorkingDays crosses a weekend", () => {
    expect(addWorkingDays("2026-10-12", 5)).toBe("2026-10-19"); // Mon + 5 = next Mon
    expect(addWorkingDays("2026-10-16", 1)).toBe("2026-10-19"); // Fri + 1 = Mon
    expect(addWorkingDays("2026-10-19", -1)).toBe("2026-10-16");
    expect(addWorkingDays("2026-10-12", 0)).toBe("2026-10-12");
  });

  it("workingDaysBetween counts only weekdays after the start", () => {
    expect(workingDaysBetween("2026-10-12", "2026-10-12")).toBe(0);
    expect(workingDaysBetween("2026-10-12", "2026-10-16")).toBe(4);
    expect(workingDaysBetween("2026-10-12", "2026-10-19")).toBe(5);
    expect(workingDaysBetween("2026-10-19", "2026-10-12")).toBe(0);
  });
});

describe("holidays (passed by the bid cadence only)", () => {
  const thanksgiving = new Set(["2026-11-26"]);
  it("skips a holiday when given one, and only then", () => {
    expect(addWorkingDays("2026-11-25", 1)).toBe("2026-11-26");
    expect(addWorkingDays("2026-11-25", 1, thanksgiving)).toBe("2026-11-27");
    expect(workingDaysBetween("2026-11-24", "2026-11-30", thanksgiving)).toBe(3);
    expect(isWorkingDay("2026-11-26", thanksgiving)).toBe(false);
    expect(previousWorkingDay("2026-11-27", thanksgiving)).toBe("2026-11-25");
    expect(onOrNextWorkingDay("2026-11-26", thanksgiving)).toBe("2026-11-27");
    expect(onOrNextWorkingDay("2026-11-25", thanksgiving)).toBe("2026-11-25");
  });
});
