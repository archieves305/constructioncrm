import { describe, expect, it } from "vitest";
import { deriveCaseState, type CaseStateInput } from "./state";

const now = new Date(2026, 8, 25, 10);
const day = (n: number) => new Date(2026, 8, 25 + n, 17);
const base: CaseStateInput = {
  status: "ACTIVE",
  currentDeadline: day(10),
  nextHearingAt: null,
  nextInspectionAt: null,
  reinspectionRequestedAt: null,
  agencyConfirmedAt: null,
  correctiveWorkCompletedAt: null,
  extensionStatus: null,
  emergency: false,
  constructionRequired: true,
  lienStatus: "NONE",
  finesAccruing: false,
  permitStatus: "REQUIRED",
  permitIssued: true,
  phase: { key: "code_violation:site_investigation", name: "Site Investigation", band: 200 },
  blockedSteps: 0,
};

describe("deriveCaseState", () => {
  it("derives overdue / due soon from the deadline and never marks a confirmed case overdue", () => {
    expect(deriveCaseState({ ...base, currentDeadline: day(-2) }, now)).toMatchObject({ overdue: true, deadlineInDays: -2 });
    expect(deriveCaseState({ ...base, currentDeadline: day(3) }, now).flags).toContain("due_soon");
    expect(deriveCaseState({ ...base, currentDeadline: day(-2), agencyConfirmedAt: now }, now).overdue).toBe(false);
    expect(deriveCaseState({ ...base, currentDeadline: day(-2), status: "CLOSED" }, now).overdue).toBe(false);
  });

  it("flags follow the facts: fines, lien, hearing, reinspection, permit, blocked work", () => {
    const s = deriveCaseState({ ...base, finesAccruing: true, lienStatus: "RECORDED", nextHearingAt: day(5), reinspectionRequestedAt: day(-1), permitStatus: "REQUIRED", permitIssued: false, extensionStatus: "REQUESTED", emergency: true }, now);
    expect(s.flags).toEqual(expect.arrayContaining(["fines_accruing", "lien_recorded", "hearing_scheduled", "reinspection_requested", "awaiting_agency", "permit_pending", "blocked_work", "extension_pending", "emergency", "construction_required"]));
    expect(deriveCaseState({ ...base, permitStatus: "UNDETERMINED" }, now).flags).toContain("permit_undetermined");
    expect(deriveCaseState({ ...base, constructionRequired: false, permitStatus: "UNDETERMINED" }, now).flags).not.toContain("blocked_work");
  });

  it("labels read from the phase and flags, and the lifecycle status wins when not ACTIVE", () => {
    expect(deriveCaseState(base, now).label).toBe("Site inspection needed");
    expect(deriveCaseState({ ...base, phase: { key: "code_violation:permit_required", name: "Permitting", band: 400 }, permitIssued: false }, now).label).toBe("Permit submitted");
    expect(deriveCaseState({ ...base, nextHearingAt: day(5) }, now).label).toBe("Hearing scheduled");
    expect(deriveCaseState({ ...base, reinspectionRequestedAt: day(-1) }, now).label).toBe("Compliance pending verification");
    expect(deriveCaseState({ ...base, status: "ON_HOLD" }, now).label).toBe("On hold");
    expect(deriveCaseState({ ...base, status: "COMPLIED", agencyConfirmedAt: now }, now).label).toBe("Complied");
    expect(deriveCaseState({ ...base, phase: null, permitStatus: "UNDETERMINED" }, now).label).toBe("Permit undetermined");
  });
});
