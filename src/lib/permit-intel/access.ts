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
