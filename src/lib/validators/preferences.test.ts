import { describe, expect, it } from "vitest";
import { mirrorLegacyPrefs, preferencesSchema } from "./preferences";

describe("preferencesSchema", () => {
  it("accepts the enums and leaves absent keys undefined", () => {
    const p = preferencesSchema.parse({ defaultListScope: "ALL", boardDensity: "COMPACT" });
    expect(p).toEqual({ defaultListScope: "ALL", boardDensity: "COMPACT" });
    expect(p.taskEmailsEnabled).toBeUndefined();
  });
  it("rejects unknown enum values", () => {
    expect(preferencesSchema.safeParse({ defaultListScope: "mine" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ boardDensity: "DENSE" }).success).toBe(false);
  });
  it("accepts an empty patch", () => {
    expect(preferencesSchema.safeParse({}).success).toBe(true);
  });
});

describe("mirrorLegacyPrefs", () => {
  const current = { notificationEmailMode: "DIGEST" as const, mutedCategories: [] as ("REMINDERS" | "ESCALATIONS" | "MENTIONS" | "TASKS" | "VIOLATIONS" | "JOB_ACTIVITY")[] };

  it("master switch off → in-app only; back on restores digest only from in-app only", () => {
    expect(mirrorLegacyPrefs({ taskEmailsEnabled: false }, current)).toEqual({ notificationEmailMode: "IN_APP_ONLY" });
    expect(mirrorLegacyPrefs({ taskEmailsEnabled: true }, { ...current, notificationEmailMode: "IN_APP_ONLY" })).toEqual({ notificationEmailMode: "DIGEST" });
    expect(mirrorLegacyPrefs({ taskEmailsEnabled: true }, { ...current, notificationEmailMode: "IMMEDIATE" })).toEqual({});
  });

  it("sub-switches mute and unmute their category without touching the others", () => {
    expect(mirrorLegacyPrefs({ reminderDigestEnabled: false }, current)).toEqual({ mutedCategories: ["REMINDERS"] });
    expect(mirrorLegacyPrefs({ nudgeEmailsEnabled: true }, { ...current, mutedCategories: ["MENTIONS", "REMINDERS"] })).toEqual({ mutedCategories: ["REMINDERS"] });
    expect(mirrorLegacyPrefs({ escalationEmailsEnabled: false }, { ...current, mutedCategories: ["ESCALATIONS"] })).toEqual({ mutedCategories: ["ESCALATIONS"] });
  });

  it("leaves everything alone when no legacy key is present", () => {
    expect(mirrorLegacyPrefs({ boardDensity: "COMPACT" }, current)).toEqual({});
  });
});
