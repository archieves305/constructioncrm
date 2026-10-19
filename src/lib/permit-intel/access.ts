import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may do what in Permit Intelligence beyond the permit record itself
 * (which follows `guardJob` and `canWriteProduction`). Explicit lists, never
 * hasMinRole. Client-safe.
 */
type Viewer = { id: string; role: RoleName | string };

/** Jurisdictions, the permit-type catalog and the requirement checklist. */
export function canManagePermitSettings(role: RoleName | string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/**
 * Freezing a package as submitted, and recording the department's answer.
 * The office roles, or the permit's own coordinator (who must also be able
 * to write the job — the route's `guardJob` checks that).
 */
export function canSubmitPermit(viewer: Viewer, permit: { assignedUserId: string | null }): boolean {
  if (viewer.role === "ADMIN" || viewer.role === "MANAGER" || viewer.role === "OFFICE_STAFF") return true;
  return !!permit.assignedUserId && permit.assignedUserId === viewer.id;
}

/**
 * Confirming a correction notice (its items become the permit's open
 * corrections and the permit moves to corrections): the same people who may
 * submit — not yet ruled, proposed.
 */
export const canConfirmCorrections = canSubmitPermit;

/**
 * Sending a drafted email about a permit. Ruled 2026-10-18: anyone involved
 * with the job (the "My jobs" rule, `jobsInvolvingUserWhere`), and the office
 * roles. `involved` is that rule's answer for this viewer and job.
 */
export function canSendPermitMessage(viewer: Viewer, involved: boolean): boolean {
  if (viewer.role === "READ_ONLY" || viewer.role === "CREW_LEAD") return false;
  return viewer.role === "ADMIN" || viewer.role === "MANAGER" || viewer.role === "OFFICE_STAFF" || involved;
}

/**
 * The product approval repository: adding an approval, checking its fields
 * against the document, linking materials. The office roles — the approvals
 * serve every job. Reading is open to everyone who works permits.
 */
export function canManageApprovals(role: RoleName | string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "OFFICE_STAFF";
}
