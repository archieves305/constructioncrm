import { describe, expect, it } from "vitest";
import { nurtureContentSchema, nurtureSettingsSchema } from "./nurture";

const good = {
  enabled: false,
  followUpDays: [2, 7, 14, 30],
  followUpEveryDaysAfter: 30,
  nurtureDays: [4, 10, 21],
  nurtureEveryDaysAfter: 30,
  nurtureMonthlyOffsetDays: 15,
  minGapHours: 48,
  sendWindowStartHour: 8,
  sendWindowEndHour: 11,
  timeZone: "America/New_York",
  weekdaysOnly: true,
  personalTouchSkipDays: 3,
  repPromptAfterDays: 10,
  excludedStageIds: [],
};

describe("nurtureSettingsSchema", () => {
  it("accepts the defaults", () => {
    expect(nurtureSettingsSchema.safeParse(good).success).toBe(true);
  });
  it("rejects unsorted or duplicate days, an inverted window, and a bad time zone", () => {
    expect(nurtureSettingsSchema.safeParse({ ...good, followUpDays: [7, 2] }).success).toBe(false);
    expect(nurtureSettingsSchema.safeParse({ ...good, nurtureDays: [4, 4] }).success).toBe(false);
    expect(nurtureSettingsSchema.safeParse({ ...good, sendWindowStartHour: 11, sendWindowEndHour: 8 }).success).toBe(false);
    expect(nurtureSettingsSchema.safeParse({ ...good, timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(nurtureSettingsSchema.safeParse({ ...good, followUpDays: [] }).success).toBe(false);
  });
});

describe("nurtureContentSchema", () => {
  it("requires a step for follow-ups only", () => {
    expect(nurtureContentSchema.safeParse({ kind: "FOLLOW_UP", subject: "Hi", body: "x" }).success).toBe(false);
    expect(nurtureContentSchema.safeParse({ kind: "FOLLOW_UP", step: 1, subject: "Hi", body: "x" }).success).toBe(true);
    expect(nurtureContentSchema.safeParse({ kind: "NURTURE", subject: "Hi", body: "x" }).success).toBe(true);
  });
});
