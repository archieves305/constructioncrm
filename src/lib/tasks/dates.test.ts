import { describe, expect, it } from "vitest";
import { parseDueAt } from "./dates";

describe("parseDueAt", () => {
  it("pins a date-only value to noon UTC so it stays on that day everywhere", () => {
    expect(parseDueAt("2026-09-25").toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });
  it("leaves a full timestamp alone", () => {
    expect(parseDueAt("2026-09-25T03:30:00.000Z").toISOString()).toBe("2026-09-25T03:30:00.000Z");
  });
});
