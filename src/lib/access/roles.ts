import type { RoleName } from "@/generated/prisma/client";

/**
 * Role lists for the lead, job and production routes that used to check only
 * for a session. Pure and client-safe. Explicit lists, never `hasMinRole`.
 * Money has its own list in `lib/money/access.ts`.
 */

/** Roles that work one customer or job at a time: by-id access follows the same "involved" rule as their lists. */
const OWN_ONLY: readonly RoleName[] = ["SALES_REP", "CREW_LEAD", "CREW_MEMBER"];

/** The field roles: a crew lead (foreman) and a crew member (W2 worker). Confined to field mode; never shown money or customer contact. */
export const CREW_ROLES: readonly RoleName[] = ["CREW_LEAD", "CREW_MEMBER"];

export function isCrewRole(role: RoleName | string | null | undefined): boolean {
  return CREW_ROLES.includes(role as RoleName);
}

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

/** Deleting a job outright (a test, or one created by mistake). */
const JOB_DELETE_ROLES: readonly RoleName[] = ["ADMIN"];

export function canDeleteJob(role: RoleName | null | undefined): boolean {
  return Boolean(role) && JOB_DELETE_ROLES.includes(role as RoleName);
}

/** Referral records and their commissions. */
const REFERRAL_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];

export function canManageReferrals(role: RoleName): boolean {
  return REFERRAL_ROLES.includes(role);
}

/** Raise a task (anyone who works in the CRM; a read-only account only looks). */
export function canCreateTasks(role: RoleName | null | undefined): boolean {
  // A crew member reports a problem instead; the office or foreman makes the task.
  return Boolean(role) && role !== "READ_ONLY" && role !== "CREW_MEMBER";
}
