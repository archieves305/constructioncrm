import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import { canAdminPartners, canManagePartners, canViewPartners, partnerPermissions } from "./access";

const ROLES: RoleName[] = ["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY", "CREW_LEAD"];

describe("partners access", () => {
  it("view: everyone in the office shell; never a crew lead", () => {
    const can = ROLES.filter(canViewPartners);
    expect(can).toEqual(["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY"]);
  });

  it("manage: office roles and sales reps; marketing and read-only look only", () => {
    const can = ROLES.filter(canManagePartners);
    expect(can).toEqual(["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF"]);
  });

  it("admin: ADMIN and MANAGER only", () => {
    expect(ROLES.filter(canAdminPartners)).toEqual(["ADMIN", "MANAGER"]);
  });

  it("handles a missing role", () => {
    expect(canViewPartners(null)).toBe(false);
    expect(canManagePartners(undefined)).toBe(false);
    expect(partnerPermissions("SALES_REP")).toEqual({ canManage: true, canAdmin: false });
  });
});
