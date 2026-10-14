import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import { canClassifyVault, canReadDocument, canUploadRestricted, canUploadVault } from "./vault-access";

const ROLES: RoleName[] = ["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY", "CREW_LEAD"];

describe("vault access", () => {
  it("SHAREABLE for every Business Development viewer; INTERNAL without marketing", () => {
    expect(ROLES.filter((role) => canReadDocument({ role }, "SHAREABLE"))).toEqual(["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY"]);
    expect(ROLES.filter((role) => canReadDocument({ role }, "INTERNAL"))).toEqual(["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "READ_ONLY"]);
  });
  it("RESTRICTED: admin always; manager and office staff only with the grant; nobody else even with it", () => {
    expect(ROLES.filter((role) => canReadDocument({ role }, "RESTRICTED"))).toEqual(["ADMIN"]);
    expect(ROLES.filter((role) => canReadDocument({ role, canViewRestrictedDocuments: true }, "RESTRICTED"))).toEqual(["ADMIN", "MANAGER", "OFFICE_STAFF"]);
  });
  it("upload and classify", () => {
    expect(ROLES.filter(canUploadVault)).toEqual(["ADMIN", "MANAGER", "OFFICE_STAFF"]);
    expect(ROLES.filter(canClassifyVault)).toEqual(["ADMIN", "MANAGER"]);
    expect(canUploadRestricted({ role: "OFFICE_STAFF" })).toBe(false);
    expect(canUploadRestricted({ role: "OFFICE_STAFF", canViewRestrictedDocuments: true })).toBe(true);
  });
});
