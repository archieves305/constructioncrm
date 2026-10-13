import { describe, expect, it } from "vitest";
import { coverage, daysUntil, deriveQualificationStatus, pickRepresentative, requirementState } from "./qualification-state";

const today = "2026-10-13";
const day = (k: string) => new Date(`${k}T12:00:00.000Z`);

describe("deriveQualificationStatus", () => {
  it("passes non-approved statuses through", () => {
    expect(deriveQualificationStatus({ status: "SUBMITTED", expiresAt: day("2020-01-01"), renewalDueAt: null }, today)).toBe("SUBMITTED");
  });
  it("an approval past its expiry is EXPIRED, on the day after", () => {
    expect(deriveQualificationStatus({ status: "APPROVED", expiresAt: day("2026-10-13"), renewalDueAt: null }, today)).toBe("APPROVED");
    expect(deriveQualificationStatus({ status: "APPROVED", expiresAt: day("2026-10-12"), renewalDueAt: null }, today)).toBe("EXPIRED");
  });
  it("renewal due once the renewal day arrives, unless already expired", () => {
    expect(deriveQualificationStatus({ status: "APPROVED", expiresAt: day("2027-01-01"), renewalDueAt: day("2026-10-13") }, today)).toBe("RENEWAL_DUE");
    expect(deriveQualificationStatus({ status: "APPROVED", expiresAt: day("2026-10-01"), renewalDueAt: day("2026-09-01") }, today)).toBe("EXPIRED");
  });
  it("counts days until", () => {
    expect(daysUntil(day("2026-10-20"), today)).toBe(7);
    expect(daysUntil(null, today)).toBeNull();
  });
});

describe("requirementState and coverage", () => {
  const req = (over: Partial<Parameters<typeof requirementState>[0]> = {}) => ({ status: "PENDING" as const, required: true, companyDocumentId: null, companyDocument: null, ...over });
  it("derives missing / provided / expired / accepted / rejected / waived", () => {
    expect(requirementState(req(), today)).toBe("missing");
    expect(requirementState(req({ companyDocumentId: "d1", companyDocument: { expiresAt: day("2027-01-01") } }), today)).toBe("provided");
    expect(requirementState(req({ companyDocumentId: "d1", companyDocument: { expiresAt: day("2026-10-01") } }), today)).toBe("expired");
    expect(requirementState(req({ companyDocumentId: "d1", companyDocument: { expiresAt: null }, status: "ACCEPTED" }), today)).toBe("accepted");
    expect(requirementState(req({ companyDocumentId: "d1", status: "REJECTED" }), today)).toBe("rejected");
    expect(requirementState(req({ status: "WAIVED" }), today)).toBe("waived");
  });
  it("coverage counts required lines; waived satisfies without a document; rejected never does", () => {
    const c = coverage(
      [
        req({ companyDocumentId: "d1", companyDocument: { expiresAt: null }, status: "ACCEPTED" }),
        req({ status: "WAIVED" }),
        req({ companyDocumentId: "d2", status: "REJECTED" }),
        req(),
        req({ required: false, companyDocumentId: "d3", companyDocument: { expiresAt: null } }),
      ],
      today,
    );
    expect(c).toEqual({ required: 4, satisfied: 2, missing: 2, optionalSatisfied: 1, optionalTotal: 1 });
  });
});

describe("pickRepresentative", () => {
  it("prefers an approval in date, else the most recently worked", () => {
    const quals = [
      { id: "a", status: "REJECTED" as const, expiresAt: null, renewalDueAt: null, updatedAt: day("2026-10-10") },
      { id: "b", status: "APPROVED" as const, expiresAt: day("2026-01-01"), renewalDueAt: null, updatedAt: day("2026-10-12") },
      { id: "c", status: "APPROVED" as const, expiresAt: day("2027-06-01"), renewalDueAt: null, updatedAt: day("2026-05-01") },
    ];
    expect(pickRepresentative(quals, today)?.id).toBe("c");
    expect(pickRepresentative(quals.slice(0, 2), today)?.id).toBe("b");
    expect(pickRepresentative([], today)).toBeNull();
  });
});
