import type { RoleName } from "@/generated/prisma/client";

/**
 * Role lists for the lead, job and production routes that used to check only
 * for a session. Pure and client-safe. Explicit lists, never `hasMinRole`.
 * Money has its own list in `lib/money/access.ts`.
 */

/** Roles that work one customer or job at a time: by-id access follows the same "involved" rule as their lists. */
const OWN_ONLY: readonly RoleName[] = ["SALES_REP", "CREW_LEAD"];

export function isOwnOnlyRole(role: RoleName): boolean {
  return OWN_ONLY.includes(role);
}

/** Create and edit leads, move their stage, log notes and contact. */
const LEAD_WRITE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING"];

export function canWriteLeads(role: RoleName): boolean {
  return LEAD_WRITE_ROLES.includes(role);
}

/** Change a job's record, stage, crews, permits and permit inspections, and raise or send change orders. */
const PRODUCTION_WRITE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"];

export function canWriteProduction(role: RoleName): boolean {
  return PRODUCTION_WRITE_ROLES.includes(role);
}

/** Approve or reject a change order internally, and delete an approved one. */
const CHANGE_ORDER_DECISION_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];

export function canDecideChangeOrder(role: RoleName): boolean {
  return CHANGE_ORDER_DECISION_ROLES.includes(role);
}
