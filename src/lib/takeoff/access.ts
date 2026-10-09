import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may do what with plan sets and takeoffs. Explicit lists, as everywhere
 * in the CRM — never a rank comparison.
 *
 * Editing (upload plans, correct the sheet index, calibrate, draw, review) is
 * open to the office roles and to a sales rep on their own leads; the lead
 * guard narrows a rep to those. Approving lines, marking a takeoff ready and
 * issuing an RFQ stay with the office. Deleting a plan set is ADMIN / MANAGER.
 */
const EDIT_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"];
const APPROVE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const DELETE_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];

export function canEditTakeoff(role: RoleName | null | undefined): boolean {
  return !!role && EDIT_ROLES.includes(role);
}

export function canApproveTakeoff(role: RoleName | null | undefined): boolean {
  return !!role && APPROVE_ROLES.includes(role);
}

export function canDeletePlanSet(role: RoleName | null | undefined): boolean {
  return !!role && DELETE_ROLES.includes(role);
}

export const TAKEOFF_EDIT_DENIED = "Your role cannot work on plan takeoffs.";
export const TAKEOFF_APPROVE_DENIED = "Approving a takeoff or issuing an RFQ is for office roles.";
export const PLAN_SET_DELETE_DENIED = "Only an admin or manager can delete a plan set.";
