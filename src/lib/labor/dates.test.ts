import { describe, expect, it } from "vitest";
import { addDays, fromDbDate, isIsoDate, toDbDate, weekStartOf } from "./dates";

describe("isIsoDate", () => {
  it("accepts real dates and rejects malformed or impossible ones", () => {
    expect(isIsoDate("2026-07-03")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false); // not a leap year
    expect(isIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("07/03/2026")).toBe(false);
    expect(isIsoDate("2026-7-3")).toBe(false);
  });
});

describe("toDbDate / fromDbDate", () => {
  it("round-trips regardless of host timezone", () => {
    expect(fromDbDate(toDbDate("2026-07-03"))).toBe("2026-07-03");
    expect(fromDbDate(toDbDate("2026-01-01"))).toBe("2026-01-01");
    expect(fromDbDate(toDbDate("2026-12-31"))).toBe("2026-12-31");
  });

  it("pins to UTC midnight", () => {
    expect(toDbDate("2026-07-03").toISOString()).toBe("2026-07-03T00:00:00.000Z");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-07-03", 7)).toBe("2026-07-10");
  });
});

describe("weekStartOf", () => {
  // 2026-07-03 is a Friday
  it("Monday weeks", () => {
    expect(weekStartOf("2026-07-03", 1)).toBe("2026-06-29"); // Mon
    expect(weekStartOf("2026-06-29", 1)).toBe("2026-06-29"); // Mon itself
    expect(weekStartOf("2026-07-05", 1)).toBe("2026-06-29"); // Sun belongs to prior Mon week
  });

  it("Sunday weeks", () => {
    expect(weekStartOf("2026-07-03", 0)).toBe("2026-06-28"); // Sun
    expect(weekStartOf("2026-06-28", 0)).toBe("2026-06-28");
    expect(weekStartOf("2026-07-04", 0)).toBe("2026-06-28"); // Sat end of week
  });
});
