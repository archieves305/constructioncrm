import { describe, expect, it } from "vitest";
import { docAlertKey, liveDocumentAlertKeys, liveQualificationAlertKeys, planDocumentAlerts, planQualificationAlerts, qualAlertKey } from "./document-alerts";

const today = "2026-10-13";
const day = (k: string) => new Date(`${k}T12:00:00.000Z`);
const doc = (expires: string | null, usedBy: string[] = []) => ({ id: "d1", title: "GL COI 2026", typeName: "General liability COI", expiresAt: expires ? day(expires) : null, usedBy });

describe("vault document alerts", () => {
  it("nothing outside the window; expiring inside 30 days, due 14 days before", () => {
    expect(planDocumentAlerts([doc("2026-12-01")], today)).toEqual([]);
    const plan = planDocumentAlerts([doc("2026-11-01", ["Moss", "Kaufman Lynn"])], today);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: "expiring", priority: "HIGH", dueDay: "2026-10-18", sourceKey: docAlertKey("d1", "expiring", "2026-11-01"), organizationId: null });
    expect(plan[0]!.title).toBe("Vault: General liability COI expires Sun, Nov 1");
    expect(plan[0]!.description).toContain("Used by 2 active qualifications: Moss, Kaufman Lynn");
  });
  it("expired is URGENT, due today, keyed on the expiry day", () => {
    const plan = planDocumentAlerts([doc("2026-10-10")], today);
    expect(plan[0]).toMatchObject({ kind: "expired", priority: "URGENT", dueDay: today, sourceKey: docAlertKey("d1", "expired", "2026-10-10") });
    expect(plan[0]!.description).toContain("lapsed 3 days ago");
  });
  it("an undated document raises nothing; live keys cover both kinds", () => {
    expect(planDocumentAlerts([doc(null)], today)).toEqual([]);
    expect([...liveDocumentAlertKeys([doc("2026-11-01")])]).toEqual([docAlertKey("d1", "expiring", "2026-11-01"), docAlertKey("d1", "expired", "2026-11-01")]);
  });
});

describe("qualification alerts", () => {
  const q = (over: Partial<Parameters<typeof planQualificationAlerts>[0][number]> = {}) => ({ id: "q1", organizationId: "o1", organizationName: "Moss", status: "APPROVED" as const, expiresAt: null, renewalDueAt: null, platform: "TradeTapp", ...over });
  it("only approved qualifications alert", () => {
    expect(planQualificationAlerts([q({ status: "SUBMITTED", expiresAt: day("2026-10-01") })], today)).toEqual([]);
  });
  it("expiring, expired and renewal, in that precedence", () => {
    expect(planQualificationAlerts([q({ expiresAt: day("2026-10-30") })], today)[0]).toMatchObject({ kind: "expiring", organizationId: "o1", sourceKey: qualAlertKey("o1", "q1", "expiring", "2026-10-30"), dueDay: "2026-10-16" });
    expect(planQualificationAlerts([q({ expiresAt: day("2026-10-01"), renewalDueAt: day("2026-09-01") })], today)[0]).toMatchObject({ kind: "expired", priority: "URGENT" });
    expect(planQualificationAlerts([q({ expiresAt: day("2027-06-01"), renewalDueAt: day("2026-10-13") })], today)[0]).toMatchObject({ kind: "renewal", sourceKey: qualAlertKey("o1", "q1", "renewal", "2026-10-13") });
    expect(planQualificationAlerts([q({ expiresAt: day("2027-06-01"), renewalDueAt: day("2026-10-14") })], today)).toEqual([]);
  });
  it("live keys", () => {
    expect(liveQualificationAlertKeys([q({ expiresAt: day("2027-06-01"), renewalDueAt: day("2026-12-01") })]).size).toBe(3);
    expect(liveQualificationAlertKeys([q({ status: "REJECTED", expiresAt: day("2027-06-01") })]).size).toBe(0);
  });
});
