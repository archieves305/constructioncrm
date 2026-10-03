import { describe, expect, it } from "vitest";
import { alertForInspection, alertsForPermit, liveAlertKeys, liveInspectionKey, nextWorkingDay, permitAlertKey, type InspectionAlertRow, type PermitAlertRow } from "./alerts";

const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const permit = (over: Partial<PermitAlertRow> = {}): PermitAlertRow => ({
  id: "p1",
  status: "APPLIED",
  submittedDate: day("2026-10-01"),
  expirationDate: null,
  permitType: "Re-roof",
  municipality: "City of Lakeland",
  permitNumber: null,
  ...over,
});

describe("alertsForPermit", () => {
  it("is quiet for the first six days", () => {
    expect(alertsForPermit(permit(), "2026-10-07")).toEqual([]);
  });

  it("asks the coordinator to check at 7 days, keyed on the submission day", () => {
    const [a] = alertsForPermit(permit(), "2026-10-08");
    expect(a).toMatchObject({ kind: "waiting-7", sourceKey: "permit:p1:waiting-7@2026-10-01", audience: "coordinator", priority: "MEDIUM", dueDay: "2026-10-08" });
    expect(a.title).toContain("7 days ago");
  });

  it("goes to the manager, high, from 14 days on — never both waiting alerts", () => {
    const alerts = alertsForPermit(permit({ status: "IN_PROGRESS" }), "2026-10-20");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "waiting-14", sourceKey: "permit:p1:waiting-14@2026-10-01", audience: "manager", priority: "HIGH" });
    expect(alerts[0].title).toContain("19 days");
  });

  it("does not chase an issued, denied or final permit, or one with no submission date", () => {
    for (const status of ["ISSUED", "DENIED", "FINAL", "EXPIRED"]) expect(alertsForPermit(permit({ status }), "2026-11-20")).toEqual([]);
    expect(alertsForPermit(permit({ submittedDate: null }), "2026-11-20")).toEqual([]);
  });

  it("warns within 30 days of expiry, due two weeks before or today", () => {
    const p = permit({ status: "ISSUED", expirationDate: day("2026-11-15") });
    expect(alertsForPermit(p, "2026-10-15")).toEqual([]);
    expect(alertsForPermit(p, "2026-10-16")[0]).toMatchObject({ kind: "expiring", sourceKey: "permit:p1:expiring@2026-11-15", dueDay: "2026-11-01", audience: "manager" });
    expect(alertsForPermit(p, "2026-11-10")[0].dueDay).toBe("2026-11-10");
    // Past its day the cron marks it Expired instead.
    expect(alertsForPermit(p, "2026-11-16")).toEqual([]);
  });

  it("a new submission or expiration date is a new alert", () => {
    expect(alertsForPermit(permit({ submittedDate: day("2026-10-05") }), "2026-10-12")[0].sourceKey).toBe(permitAlertKey("p1", "waiting-7", "2026-10-05"));
  });
});

describe("liveAlertKeys", () => {
  it("keeps the waiting keys while in review and drops them once issued", () => {
    expect([...liveAlertKeys(permit())]).toEqual(["permit:p1:waiting-7@2026-10-01", "permit:p1:waiting-14@2026-10-01"]);
    expect(liveAlertKeys(permit({ status: "ISSUED" })).size).toBe(0);
    expect([...liveAlertKeys(permit({ status: "ISSUED", expirationDate: day("2027-01-01") }))]).toEqual(["permit:p1:expiring@2027-01-01"]);
    expect(liveAlertKeys(permit({ status: "FINAL", expirationDate: day("2027-01-01") })).size).toBe(0);
  });
});

describe("inspection reminders", () => {
  const insp = (over: Partial<InspectionAlertRow> = {}): InspectionAlertRow => ({
    id: "i1",
    type: "ROOFING_FINAL",
    result: "SCHEDULED",
    scheduledFor: day("2026-10-06"),
    permit: { permitType: "Re-roof", municipality: "Polk County" },
    ...over,
  });

  it("the next working day skips the weekend", () => {
    expect(nextWorkingDay("2026-10-05")).toBe("2026-10-06");
    expect(nextWorkingDay("2026-10-09")).toBe("2026-10-12");
  });

  it("is raised the working day before, due on the inspection day", () => {
    expect(alertForInspection(insp(), "2026-10-04")).toBeNull();
    const a = alertForInspection(insp(), "2026-10-05")!;
    expect(a).toMatchObject({ sourceKey: "permit-inspection:i1:ready@2026-10-06", dueDay: "2026-10-06", audience: "field", priority: "HIGH" });
    expect(a.title).toBe("Be ready for the roofing final inspection — Tue, Oct 6");
    // Not on the day itself, and not once it has a result.
    expect(alertForInspection(insp(), "2026-10-06")).toBeNull();
    expect(alertForInspection(insp({ result: "PASS" }), "2026-10-05")).toBeNull();
  });

  it("a Friday run covers Saturday, Sunday and Monday", () => {
    for (const d of ["2026-10-10", "2026-10-11", "2026-10-12"]) expect(alertForInspection(insp({ scheduledFor: day(d) }), "2026-10-09")).not.toBeNull();
    expect(alertForInspection(insp({ scheduledFor: day("2026-10-13") }), "2026-10-09")).toBeNull();
  });

  it("a timed appointment is read on the office day and names the time", () => {
    // 01:30 UTC on the 7th is 9:30 pm on the 6th in the office.
    const a = alertForInspection(insp({ scheduledFor: new Date("2026-10-07T01:30:00.000Z") }), "2026-10-05")!;
    expect(a.dueDay).toBe("2026-10-06");
    expect(a.title).toContain("9:30 PM");
  });

  it("the live key follows the booked day and is gone with a result", () => {
    expect(liveInspectionKey(insp())).toBe("permit-inspection:i1:ready@2026-10-06");
    expect(liveInspectionKey(insp({ result: "FAIL" }))).toBeNull();
    expect(liveInspectionKey(insp({ scheduledFor: null }))).toBeNull();
  });
});
