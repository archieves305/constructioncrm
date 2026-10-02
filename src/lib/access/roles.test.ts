import { describe, expect, it } from "vitest";
import { canDecideChangeOrder, canManageReferrals, canWriteLeads, canWriteProduction, isOwnOnlyRole } from "./roles";

const ALL = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "READ_ONLY", "CREW_LEAD"] as const;
const allowed = (fn: (r: never) => boolean) => ALL.filter((r) => fn(r as never));

describe("role lists", () => {
  it("own-only roles are the sales rep and the crew lead", () => {
    expect(allowed(isOwnOnlyRole)).toEqual(["SALES_REP", "CREW_LEAD"]);
  });

  it("leads: everyone in the office shell but read-only; never a crew lead", () => {
    expect(allowed(canWriteLeads)).toEqual(["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING"]);
  });

  it("production records: office roles and the sales rep; not marketing, read-only or a crew lead", () => {
    expect(allowed(canWriteProduction)).toEqual(["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"]);
  });

  it("change-order decisions stay with admin and manager — the set hasMinRole(MANAGER) used to give", () => {
    expect(allowed(canDecideChangeOrder)).toEqual(["ADMIN", "MANAGER"]);
  });

  it("referrals and their commissions are admin and manager only", () => {
    expect(allowed(canManageReferrals)).toEqual(["ADMIN", "MANAGER"]);
  });
});
