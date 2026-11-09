import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import { navSectionsFor } from "./nav-sections";
import { canWriteLeads, canManageReferrals } from "@/lib/access/roles";
import { canViewCompanyFinancials } from "@/lib/money/access";

const ROLES: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "CREW_LEAD", "READ_ONLY"];
const hrefs = (role: RoleName) => navSectionsFor(role).flatMap((s) => s.items.map((i) => i.href));

// Each page here answers 403 to roles outside its API's list; the nav must not offer it to them.
const API_RULES: Record<string, (r: RoleName) => boolean> = {
  "/canvassing": canWriteLeads,
  "/referrals": canManageReferrals,
  "/collections": canViewCompanyFinancials,
  "/vendors": canViewCompanyFinancials,
  "/field-logs": (r) => ["ADMIN", "MANAGER", "OFFICE_STAFF"].includes(r),
  "/response-dashboard": (r) => ["ADMIN", "MANAGER"].includes(r),
};

describe("navSectionsFor", () => {
  for (const [href, allowed] of Object.entries(API_RULES)) {
    it(`offers ${href} only to the roles its API answers`, () => {
      for (const role of ROLES) expect(hrefs(role).includes(href), `${role} ${href}`).toBe(allowed(role));
    });
  }
  it("a sales rep is not offered personnel, daily logs or referrals", () => {
    const h = hrefs("SALES_REP");
    expect(h).not.toContain("/personnel");
    expect(h).not.toContain("/field-logs");
    expect(h).not.toContain("/referrals");
  });
  it("drops sections left with no items", () => {
    for (const role of ROLES) for (const s of navSectionsFor(role)) expect(s.items.length).toBeGreaterThan(0);
  });
});
