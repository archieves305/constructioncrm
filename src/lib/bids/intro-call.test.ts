import { describe, expect, it } from "vitest";
import { dueLabel, introCallPlan, type IntroCallInput } from "./intro-call";

const TZ = "America/New_York";
const base = (over: Partial<IntroCallInput> = {}): IntroCallInput => ({
  submittedAt: new Date("2026-11-20T16:00:00Z"), // Fri 11:00 ET
  now: new Date("2026-11-20T17:00:00Z"),
  holidays: new Set<string>(),
  tz: TZ,
  isFirstWithGc: true,
  gc: "Coastal Choice",
  project: "MIA CT Restrooms",
  bidNumber: "BID-00007",
  scopes: ["Drywall", "Plumbing"],
  amount: 184500,
  contacts: [{ name: "Ana Ruiz", title: "Senior Estimator", phone: "305-555-0100", mobile: null, email: "ana@example.com" }],
  accountUrl: "https://crm.careyos.com/partners/org1",
  ...over,
});

describe("introCallPlan", () => {
  it("is due the next business morning at 9:00 local: Friday → Monday", () => {
    const p = introCallPlan(base())!;
    expect(p.dueDay).toBe("2026-11-23");
    expect(p.dueAt.toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(dueLabel(p.dueAt, TZ)).toBe("Mon 9:00 AM");
  });

  it("skips holidays (the day before Thanksgiving → the Friday after)", () => {
    const p = introCallPlan(base({ submittedAt: new Date("2026-11-25T15:00:00Z"), now: new Date("2026-11-25T15:00:00Z"), holidays: new Set(["2026-11-26"]) }))!;
    expect(p.dueDay).toBe("2026-11-27");
  });

  it("counts from today, not from a back-dated submission", () => {
    const p = introCallPlan(base({ submittedAt: new Date("2026-11-16T15:00:00Z") }))!;
    expect(p.dueDay).toBe("2026-11-23");
  });

  it("raises nothing for a submission more than 14 days old", () => {
    expect(introCallPlan(base({ submittedAt: new Date("2026-11-06T15:00:00Z") }))).not.toBeNull();
    expect(introCallPlan(base({ submittedAt: new Date("2026-11-05T15:00:00Z") }))).toBeNull();
  });

  it("introduces KNU to a GC we have never bid to", () => {
    const p = introCallPlan(base())!;
    expect(p.title).toBe("Call Coastal Choice: introduce KNU — we bid MIA CT Restrooms");
    expect(p.description).toContain("first bid to Coastal Choice");
    expect(p.description).toContain("Drywall, Plumbing on MIA CT Restrooms, $184,500 (BID-00007)");
    expect(p.description).toContain("prequalification");
  });

  it("is a short confirm call for a GC we know", () => {
    const p = introCallPlan(base({ isFirstWithGc: false }))!;
    expect(p.title).toBe("Call Coastal Choice: we bid MIA CT Restrooms — confirm they have it");
    expect(p.description).toContain("bid to Coastal Choice before");
    expect(p.description).not.toContain("prequalification");
  });

  it("lists who to call with their numbers, or says to find the estimator", () => {
    expect(introCallPlan(base())!.description).toContain("- Ana Ruiz, Senior Estimator — office 305-555-0100");
    const email = introCallPlan(base({ contacts: [{ name: "Bo Lee", email: "bo@example.com" }] }))!.description;
    expect(email).toContain("- Bo Lee — email bo@example.com (no phone on file)");
    const none = introCallPlan(base({ contacts: [] }))!.description;
    expect(none).toContain("find their estimator on the account page (https://crm.careyos.com/partners/org1)");
  });
});
