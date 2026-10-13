import { describe, expect, it } from "vitest";
import { addWorkingDays, isWorkingDay, previousWorkingDay, workingDaysBetween } from "./working-days";

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
