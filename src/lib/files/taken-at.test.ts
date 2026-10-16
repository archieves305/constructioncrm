import { describe, it, expect } from "vitest";
import { parseTakenAt } from "./taken-at";

const now = new Date("2026-10-16T12:00:00Z");

describe("parseTakenAt", () => {
  it("reads an ISO instant", () => {
    expect(parseTakenAt("2026-09-03T14:22:10.000Z", now)?.toISOString()).toBe("2026-09-03T14:22:10.000Z");
  });
  it("drops what is missing or unreadable", () => {
    expect(parseTakenAt(null, now)).toBeNull();
    expect(parseTakenAt("", now)).toBeNull();
    expect(parseTakenAt("yesterday", now)).toBeNull();
  });
  it("drops camera clocks that were never set, and dates in the future", () => {
    expect(parseTakenAt("1970-01-01T00:00:00Z", now)).toBeNull();
    expect(parseTakenAt("2026-10-20T00:00:00Z", now)).toBeNull();
    expect(parseTakenAt("2026-10-17T06:00:00Z", now)).not.toBeNull();
  });
});
