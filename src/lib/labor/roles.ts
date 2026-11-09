import type { RoleName } from "@/generated/prisma/client";

/**
 * Role-only checks for the field-labor module. Pure and client-safe (no
 * Prisma), so a page can hide a button the API would refuse. Grant-based
 * checks (SSNs, pay rates, payroll) stay in ./permissions.
 */
export const OFFICE_ROLES: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

/** Create/edit personnel records (non-sensitive fields). */
export function canManagePersonnel(role: RoleName): boolean {
  return OFFICE_ROLES.includes(role);
}

/**
 * Create a basic personnel record. Crew leads may add a worker who shows up
 * onsite (name/trade/phone/crew only — the POST route whitelists); rates,
 * SSNs, and edits remain office-only.
 */
export function canCreatePersonnel(role: RoleName): boolean {
  return canManagePersonnel(role) || role === "CREW_LEAD";
}

/** See the roster at all (CREW_LEAD/READ_ONLY get a reduced field set). */
export function canReadPersonnel(role: RoleName): boolean {
  return OFFICE_ROLES.includes(role) || role === "CREW_LEAD" || role === "READ_ONLY";
}

