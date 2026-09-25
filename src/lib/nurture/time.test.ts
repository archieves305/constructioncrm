import { describe, expect, it } from "vitest";
import { addLocalDays, isInWindow, localDateKey, nextSendSlot, slotKeyFor, windowStartOn, type SendWindow } from "./time";

const NY: SendWindow = { startHour: 8, endHour: 11, timeZone: "America/New_York", weekdaysOnly: true };
// 2026-09-25 is a Friday. EDT = UTC-4 until 2026-11-01, EST = UTC-5 after.
const fri1500 = new Date("2026-09-25T19:00:00Z"); // 15:00 EDT
const fri0730 = new Date("2026-09-25T11:30:00Z"); // 07:30 EDT
const fri0900 = new Date("2026-09-25T13:00:00Z"); // 09:00 EDT

describe("isInWindow", () => {
  it("is true inside 08:00–11:00 on a weekday and false outside", () => {
    expect(isInWindow(fri0900, NY)).toBe(true);
    expect(isInWindow(fri0730, NY)).toBe(false);
    expect(isInWindow(fri1500, NY)).toBe(false);
    expect(isInWindow(new Date("2026-09-25T15:00:00Z"), NY)).toBe(false); // 11:00 exactly is out
  });
  it("is false on weekends when weekdaysOnly", () => {
    expect(isInWindow(new Date("2026-09-26T13:00:00Z"), NY)).toBe(false); // Saturday 09:00
    expect(isInWindow(new Date("2026-09-26T13:00:00Z"), { ...NY, weekdaysOnly: false })).toBe(true);
  });
});

describe("nextSendSlot", () => {
  it("keeps a time already in the window", () => {
    expect(nextSendSlot(fri0900, NY).toISOString()).toBe(fri0900.toISOString());
  });
  it("moves 07:30 to 08:00 the same day", () => {
    expect(nextSendSlot(fri0730, NY).toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });
  it("moves Friday afternoon to Monday 08:00", () => {
    expect(nextSendSlot(fri1500, NY).toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });
  it("moves Saturday to Monday 08:00", () => {
    expect(nextSendSlot(new Date("2026-09-26T13:00:00Z"), NY).toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });
  it("lands on 08:00 local on both sides of the November clock change", () => {
    // Fri 2026-10-30 15:00 EDT → Mon 2026-11-02 08:00 EST = 13:00Z
    expect(nextSendSlot(new Date("2026-10-30T19:00:00Z"), NY).toISOString()).toBe("2026-11-02T13:00:00.000Z");
    // Fri 2026-03-06 15:00 EST → Mon 2026-03-09 08:00 EDT = 12:00Z
    expect(nextSendSlot(new Date("2026-03-06T20:00:00Z"), NY).toISOString()).toBe("2026-03-09T12:00:00.000Z");
  });
});

describe("addLocalDays / windowStartOn / slot keys", () => {
  it("keeps the local clock across a DST change", () => {
    const before = new Date("2026-10-31T12:00:00Z"); // Sat 08:00 EDT
    const after = addLocalDays(before, 2, "America/New_York"); // Mon 08:00 EST
    expect(after.toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
  it("window start uses the date's own offset", () => {
    expect(windowStartOn(new Date("2026-11-02T20:00:00Z"), NY).toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
  it("slot keys use the New York date, not UTC", () => {
    // 03:00Z on the 26th is still the 25th in New York.
    expect(localDateKey(new Date("2026-09-26T03:00:00Z"), "America/New_York")).toBe("2026-09-25");
    expect(slotKeyFor("FOLLOW_UP", new Date("2026-09-26T03:00:00Z"), "America/New_York")).toBe("FOLLOW_UP:2026-09-25");
  });
});
