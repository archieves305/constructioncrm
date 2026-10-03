import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may see and who may change the vendor directory.
 *
 * Explicit role lists, never `hasMinRole` (the hierarchy ranks SALES_REP above
 * OFFICE_STAFF). Pure and client-safe, so a page can hide what the server
 * would refuse.
 */
const VENDOR_MANAGE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const VENDOR_VIEW_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"];

export function canManageVendors(role: RoleName | null | undefined): boolean {
  return Boolean(role) && VENDOR_MANAGE_ROLES.includes(role as RoleName);
}

export function canViewVendors(role: RoleName | null | undefined): boolean {
  return Boolean(role) && VENDOR_VIEW_ROLES.includes(role as RoleName);
}

/** Choosing who receives vendor expiry tasks. */
export function canSetComplianceOwner(role: RoleName | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export const VENDOR_VIEW_ROLE_LIST = VENDOR_VIEW_ROLES;
export const VENDOR_DENIED_MESSAGE = "You don't have permission to manage vendors.";
