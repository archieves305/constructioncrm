import { describe, expect, it } from "vitest";
import { canEditJobRecord, canManageJobMoney, canViewCompanyFinancials, touchesJobMoney } from "./access";

describe("canManageJobMoney", () => {
  it("is the office and accounting roles only", () => {
    expect(["ADMIN", "MANAGER", "OFFICE_STAFF"].every((r) => canManageJobMoney(r as never))).toBe(true);
  });

  it("refuses sales, marketing, read-only and crew leads — sales outranks accounting in the hierarchy but not here", () => {
    for (const r of ["SALES_REP", "MARKETING", "READ_ONLY", "CREW_LEAD"]) expect(canManageJobMoney(r as never)).toBe(false);
    expect(canManageJobMoney(null)).toBe(false);
  });
});

describe("canViewCompanyFinancials", () => {
  it("adds read-only to the money roles and nobody else", () => {
    expect(canViewCompanyFinancials("READ_ONLY")).toBe(true);
    expect(canViewCompanyFinancials("OFFICE_STAFF")).toBe(true);
    expect(canViewCompanyFinancials("SALES_REP")).toBe(false);
    expect(canViewCompanyFinancials("CREW_LEAD")).toBe(false);
  });
});

describe("canEditJobRecord", () => {
  it("lets a sales rep edit the record but not read-only, marketing or a crew lead", () => {
    expect(canEditJobRecord("SALES_REP")).toBe(true);
    for (const r of ["READ_ONLY", "MARKETING", "CREW_LEAD"]) expect(canEditJobRecord(r as never)).toBe(false);
  });
});

describe("touchesJobMoney", () => {
  it("is true for any pricing field, even when set to null or zero", () => {
    expect(touchesJobMoney({ contractAmount: 0 })).toBe(true);
    expect(touchesJobMoney({ marginType: null })).toBe(true);
    expect(touchesJobMoney({ jobType: "COST_PLUS", nextAction: "x" })).toBe(true);
  });

  it("is false for the job record's own fields", () => {
    expect(touchesJobMoney({ nextAction: "Call", targetStartDate: "2026-10-12", projectManagerId: "u1" })).toBe(false);
    expect(touchesJobMoney({})).toBe(false);
  });
});
