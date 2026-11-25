import type { RoleName } from "@/generated/prisma/client";
import type { FieldAccess } from "@/lib/labor/permissions";

/**
 * Who may do what on an inspection. Pure, explicit role lists (rulings
 * 2026-11-25):
 * - office roles and the job's project manager review findings;
 * - crews photograph but never see a finding the AI proposed until a person
 *   confirms it;
 * - accepting over an open blocker is ADMIN / MANAGER, with a reason.
 */
const OFFICE: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const CREW: readonly RoleName[] = ["CREW_LEAD", "CREW_MEMBER"];

export function isOffice(role: RoleName): boolean {
  return OFFICE.includes(role);
}

/** Roles that may start an inspection at all (on a job they may also need to be on it). */
export function canStartInspection(role: RoleName): boolean {
  return [...OFFICE, "SALES_REP", ...CREW].includes(role);
}

/** An inspection with no job: office roles and sales reps (the phone's Quick inspection). */
export function canStartWithoutJob(role: RoleName): boolean {
  return [...OFFICE, "SALES_REP"].includes(role);
}

export type InspectionScope = {
  startedByUserId: string;
  status: "OPEN" | "ACCEPTED" | "CLOSED";
  job: { projectManagerId: string | null; salesRepId: string | null } | null;
};

export type InspectionRights = {
  canView: boolean;
  /** Sees what the AI proposed (not only what a person confirmed). */
  canSeeProposed: boolean;
  canAddPhotos: boolean;
  /** Attach a job or contract, edit the scope, name areas. */
  canEdit: boolean;
  /** Confirm, dismiss and edit findings; raise punch items; accept. */
  canReview: boolean;
  /** Accept over an open blocker, with a reason. */
  canOverride: boolean;
};

/** `field` is the viewer's field access on the inspection's job (null when it has none). */
export function inspectionRights(viewer: { id: string; role: RoleName }, i: InspectionScope, field: FieldAccess | null): InspectionRights {
  const role = viewer.role;
  const office = isOffice(role);
  const crew = CREW.includes(role);
  const pm = !!i.job && i.job.projectManagerId === viewer.id;
  const starter = i.startedByUserId === viewer.id;
  const onJob = !!i.job && !!field && field !== "none";
  const canView = office || role === "READ_ONLY" || pm || starter || onJob;
  const open = i.status === "OPEN";
  const canReview = (office || pm) && open;
  const canSeeProposed = canView && !crew;
  const canAddPhotos =
    open &&
    role !== "READ_ONLY" &&
    role !== "MARKETING" &&
    (office || pm || starter || (onJob && (field === "contribute" || field === "write" || (role === "SALES_REP" && field === "read"))));
  const canEdit = open && (office || pm || (starter && !crew));
  return { canView, canSeeProposed, canAddPhotos, canEdit, canReview, canOverride: open && (role === "ADMIN" || role === "MANAGER") };
}
