import { describe, expect, it } from "vitest";
import { preferencesSchema } from "./preferences";

describe("preferencesSchema", () => {
  it("accepts the enums and leaves absent keys undefined", () => {
    const p = preferencesSchema.parse({ defaultListScope: "ALL", boardDensity: "COMPACT" });
    expect(p).toEqual({ defaultListScope: "ALL", boardDensity: "COMPACT" });
    expect(p.taskEmailsEnabled).toBeUndefined();
  });
  it("rejects unknown enum values", () => {
    expect(preferencesSchema.safeParse({ defaultListScope: "mine" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ boardDensity: "DENSE" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ defaultCalendarView: "people" }).success).toBe(false);
  });
  it("accepts the calendar's default view", () => {
    expect(preferencesSchema.parse({ defaultCalendarView: "DAY" })).toEqual({ defaultCalendarView: "DAY" });
  });
});
