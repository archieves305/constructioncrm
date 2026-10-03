import { describe, expect, it } from "vitest";
import { canManageRoofPricing } from "./access";

describe("canManageRoofPricing", () => {
  it("is admin and manager only — costs are not shown to sales, office, field or read-only roles", () => {
    expect(canManageRoofPricing("ADMIN")).toBe(true);
    expect(canManageRoofPricing("MANAGER")).toBe(true);
    for (const role of ["OFFICE_STAFF", "SALES_REP", "MARKETING", "CREW_LEAD", "READ_ONLY"] as const) expect(canManageRoofPricing(role)).toBe(false);
    expect(canManageRoofPricing(null)).toBe(false);
  });
});
