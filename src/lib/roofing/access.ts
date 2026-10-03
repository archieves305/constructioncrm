import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may see and change what roofing materials cost and how a takeoff is
 * calculated. Explicit list, never `hasMinRole`. Costs are not shown to sales
 * or field roles until that is ruled on.
 */
const PRICING_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];

export function canManageRoofPricing(role: RoleName | null | undefined): boolean {
  return Boolean(role) && PRICING_ROLES.includes(role as RoleName);
}

export const ROOF_PRICING_DENIED = "Only an admin or manager can see or change roofing prices and takeoff rules.";
