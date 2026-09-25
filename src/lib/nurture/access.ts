import type { RoleName } from "@/generated/prisma/client";

// Explicit role lists, never hasMinRole.
export const NURTURE_MANAGE_ROLES: readonly RoleName[] = ["ADMIN"];
export const NURTURE_VIEW_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];
/** Pause / resume / stop / enrol / mark a touch on one lead. */
export const NURTURE_LEAD_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF"];

export const canManageNurture = (r: RoleName) => NURTURE_MANAGE_ROLES.includes(r);
export const canViewNurture = (r: RoleName) => NURTURE_VIEW_ROLES.includes(r);
export const canActOnLeadNurture = (r: RoleName) => NURTURE_LEAD_ROLES.includes(r);
