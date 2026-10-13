import { describe, expect, it } from "vitest";
import { createContactSchema, createInteractionSchema, createOrganizationSchema, settingsSchema, stageChangeSchema, updateOrganizationSchema } from "./validation";

describe("partners validation", () => {
  it("accepts a minimal organization and nulls on a patch", () => {
    expect(createOrganizationSchema.safeParse({ name: "Moss", kind: "GENERAL_CONTRACTOR" }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ name: "M", kind: "GENERAL_CONTRACTOR" }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ potentialAnnualRevenue: null, priority: null, ownerUserId: null, website: "" }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ paymentTermsDays: 400 }).success).toBe(false);
  });

  it("needs a reason only to write an account off", () => {
    expect(stageChangeSchema.safeParse({ stage: "DORMANT" }).success).toBe(true);
    expect(stageChangeSchema.safeParse({ stage: "DO_NOT_PURSUE" }).success).toBe(false);
    expect(stageChangeSchema.safeParse({ stage: "DO_NOT_PURSUE", reason: "Union shop only" }).success).toBe(true);
    expect(stageChangeSchema.safeParse({ stage: "WON" }).success).toBe(false);
  });

  it("contacts need a name; ratings are 1–5", () => {
    expect(createContactSchema.safeParse({ firstName: "Ana", lastName: "Ruiz" }).success).toBe(true);
    expect(createContactSchema.safeParse({ firstName: "Ana", lastName: "Ruiz", influence: 6 }).success).toBe(false);
    expect(createContactSchema.safeParse({ firstName: "Ana", lastName: "Ruiz", email: "not-an-email" }).success).toBe(false);
  });

  it("an interaction needs a kind, an outcome and a summary; the follow-up carries a day", () => {
    expect(createInteractionSchema.safeParse({ kind: "CALL", outcome: "NO_ANSWER", summary: "Left voicemail" }).success).toBe(true);
    expect(createInteractionSchema.safeParse({ kind: "CALL", summary: "x" }).success).toBe(false);
    expect(createInteractionSchema.safeParse({ kind: "CALL", outcome: "SPOKE", summary: "ok", followUp: { title: "Call back", dueDay: "2026-10-20" } }).success).toBe(true);
    expect(createInteractionSchema.safeParse({ kind: "CALL", outcome: "SPOKE", summary: "ok", followUp: { title: "Call back", dueDay: "next week" } }).success).toBe(false);
    const parsed = createInteractionSchema.parse({ kind: "EMAIL", outcome: "SENT", summary: "Sent capabilities statement" });
    expect(parsed.direction).toBe("OUTBOUND");
  });

  it("settings are bounded", () => {
    expect(settingsSchema.safeParse({ newTargetDays: 3, markets: ["Broward"] }).success).toBe(true);
    expect(settingsSchema.safeParse({ dormantAfterDays: 7 }).success).toBe(false);
  });
});
