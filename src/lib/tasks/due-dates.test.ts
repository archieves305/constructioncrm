import { describe, expect, it } from "vitest";
import { daysOverdue, dueInBusinessDays, dueTomorrow } from "./due-dates";

describe("due-dates", () => {
  it("three business days from a Friday is Wednesday at 5pm", () => {
    const fri = new Date(2026, 8, 25, 10, 0); // Fri 25 Sep 2026
    const d = dueInBusinessDays(3, fri);
    expect(d.getDay()).toBe(3);
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(17);
  });
  it("tomorrow from Saturday is Sunday morning — crews work weekends", () => {
    const sat = new Date(2026, 8, 26, 15, 0);
    const d = dueTomorrow(sat);
    expect(d.getDay()).toBe(0);
    expect(d.getHours()).toBe(9);
  });
  it("counts calendar days overdue against the start of today", () => {
    const today = new Date(2026, 8, 24, 8, 0);
    expect(daysOverdue(new Date(2026, 8, 22, 23, 0), today)).toBe(2);
    expect(daysOverdue(new Date(2026, 8, 24, 1, 0), today)).toBe(0);
    expect(daysOverdue(new Date(2026, 8, 25), today)).toBe(-1);
  });
});
