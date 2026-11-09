import { describe, expect, it } from "vitest";
import { isMyDayWindow, myDayText } from "./my-day";

describe("my day", () => {
  it("says nothing on an empty day", () => {
    expect(myDayText(0, 0)).toBeNull();
  });
  it("counts what is due and overdue", () => {
    expect(myDayText(1, 0)?.body).toBe("1 task due today. Tap to see them.");
    expect(myDayText(3, 2)?.body).toBe("3 tasks due today, 2 overdue. Tap to see them.");
    expect(myDayText(0, 4)?.body).toBe("4 overdue. Tap to see them.");
  });
  it("sends on a weekday morning in the office only", () => {
    expect(isMyDayWindow(new Date("2026-11-09T12:05:00Z"))).toBe(true); // Mon 7:05 am EST
    expect(isMyDayWindow(new Date("2026-11-09T11:30:00Z"))).toBe(false); // 6:30 am
    expect(isMyDayWindow(new Date("2026-11-09T22:00:00Z"))).toBe(false); // evening
    expect(isMyDayWindow(new Date("2026-11-08T12:05:00Z"))).toBe(false); // Sunday
    expect(isMyDayWindow(new Date("2026-07-06T11:05:00Z"))).toBe(true); // Mon 7:05 am EDT
  });
});
