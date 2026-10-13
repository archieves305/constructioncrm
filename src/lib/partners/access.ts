import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may see and who may change Business Development records.
 *
 * Explicit role lists, never `hasMinRole` (the hierarchy ranks SALES_REP above
 * OFFICE_STAFF). Pure and client-safe, so a page can hide what the server
 * would refuse. Courting a GC is sales work, so SALES_REP manages accounts;
 * changing who owns an account, writing one off and the settings are for
 * ADMIN / MANAGER.
 */
export const PARTNER_VIEW_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "READ_ONLY"];
export const PARTNER_MANAGE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"];
export const PARTNER_ADMIN_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];

function has(list: readonly RoleName[], role: RoleName | null | undefined): boolean {
  return Boolean(role) && list.includes(role as RoleName);
}

/** Open the lists and pages. */
export function canViewPartners(role: RoleName | null | undefined): boolean {
  return has(PARTNER_VIEW_ROLES, role);
}

/** Create and edit accounts and contacts, log interactions, move stages. */
export function canManagePartners(role: RoleName | null | undefined): boolean {
  return has(PARTNER_MANAGE_ROLES, role);
}

/** Change the owner, mark an account Do not pursue, delete one, edit the settings. */
export function canAdminPartners(role: RoleName | null | undefined): boolean {
  return has(PARTNER_ADMIN_ROLES, role);
}

export type PartnerPermissions = { canManage: boolean; canAdmin: boolean };

export function partnerPermissions(role: RoleName | null | undefined): PartnerPermissions {
  return { canManage: canManagePartners(role), canAdmin: canAdminPartners(role) };
}

export const PARTNER_DENIED_MESSAGE = "You don't have access to Business Development records.";
