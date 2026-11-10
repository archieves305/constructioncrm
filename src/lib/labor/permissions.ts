import type { RoleName } from "@/generated/prisma/client";
import { jobsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { prisma } from "@/lib/db/prisma";
import { OFFICE_ROLES } from "./roles";

// Access rules for the field-labor module. Payroll/sensitive checks use
// explicit role lists — never hasMinRole — because the numeric hierarchy
// ranks SALES_REP above OFFICE_STAFF ("Accounting"), yet sales must not see
// payroll data.

export type FieldGrants = {
  canViewSensitivePersonnel: boolean;
  canEditPayRates: boolean;
  canViewPayrollReports: boolean;
};

export const NO_GRANTS: FieldGrants = {
  canViewSensitivePersonnel: false,
  canEditPayRates: false,
  canViewPayrollReports: false,
};

// Grants are read fresh from the DB (not the 8h JWT) so revocation is
// instant. Callers pass session.user.id.
export async function getFieldGrants(userId: string): Promise<FieldGrants> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      canViewSensitivePersonnel: true,
      canEditPayRates: true,
      canViewPayrollReports: true,
    },
  });
  return user ?? NO_GRANTS;
}

// The role-only checks are pure and client-safe; they live in ./roles so
// pages can hide what the API would refuse. Re-exported for the routes.
export { canManagePersonnel, canCreatePersonnel, canReadPersonnel } from "./roles";

/** Reveal SSNs and open W-9/ID documents. Every use is audited. */
export function canViewSensitivePersonnel(
  role: RoleName,
  grants: FieldGrants,
): boolean {
  if (role === "ADMIN") return true;
  return (
    (role === "MANAGER" || role === "OFFICE_STAFF") &&
    grants.canViewSensitivePersonnel
  );
}

/** Read hourly rates and per-entry labor costs. */
export function canSeeLaborCosts(role: RoleName): boolean {
  return OFFICE_ROLES.includes(role);
}

/** Write hourly rates (personnel) and rate overrides (labor entries). */
export function canEditPayRates(role: RoleName, grants: FieldGrants): boolean {
  if (role === "ADMIN") return true;
  return (
    (role === "MANAGER" || role === "OFFICE_STAFF") && grants.canEditPayRates
  );
}

/** Cross-job per-person labor reports and the payroll CSV export. */
export function canViewPayroll(role: RoleName, grants: FieldGrants): boolean {
  if (role === "ADMIN" || role === "OFFICE_STAFF") return true;
  return role === "MANAGER" && grants.canViewPayrollReports;
}

// ── Job-scoped field access (daily logs, labor sheets, photos) ─────────────

export type FieldAccess = "none" | "read" | "write";

type JobScope = {
  projectManagerId: string | null;
  salesRepId: string | null;
};

/**
 * Pure access decision for one job's field data. `hasAssignment` = a
 * JobFieldAssignment row exists for (job, viewer).
 */
export function jobFieldAccess(
  viewer: { id: string; role: RoleName },
  job: JobScope,
  hasAssignment: boolean,
): FieldAccess {
  switch (viewer.role) {
    case "ADMIN":
    case "MANAGER":
    case "OFFICE_STAFF":
      return "write";
    case "CREW_LEAD":
      return hasAssignment || job.projectManagerId === viewer.id ? "write" : "none";
    case "SALES_REP":
      return job.salesRepId === viewer.id ? "read" : "none";
    case "READ_ONLY":
      return "read";
    default:
      return "none";
  }
}

/** Load the job's scope fields + assignment row and decide access. */
export async function resolveJobFieldAccess(
  viewer: { id: string; role: RoleName },
  jobId: string,
): Promise<{ job: { id: string; projectManagerId: string | null; salesRepId: string | null } | null; access: FieldAccess }> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, projectManagerId: true, salesRepId: true },
  });
  if (!job) return { job: null, access: "none" };

  // A crew lead is "on the job" by the one rule every job guard uses
  // (jobsInvolvingUserWhere): a field assignment, PM, a team slot, a crew they
  // belong to, an open step of theirs. This used to be the field assignment
  // alone, so a crew lead could open a job's files but not its logs.
  let hasAssignment = false;
  if (viewer.role === "CREW_LEAD") {
    hasAssignment = Boolean(
      await prisma.job.findFirst({ where: { AND: [{ id: jobId }, jobsInvolvingUserWhere(viewer.id)] }, select: { id: true } }),
    );
  }
  return { job, access: jobFieldAccess(viewer, job, hasAssignment) };
}

// ── Daily-log workflow transitions ──────────────────────────────────────────

export type LogStatus = "DRAFT" | "SUBMITTED" | "APPROVED";

/**
 * Correct an APPROVED log in place, without reopening it. Accounting is the
 * one that matters day to day: the bookkeeper finds a bad shift after the
 * day was approved and has to fix it, and dropping the log back to DRAFT
 * would pull the whole day out of the payroll export (payrollApprovedOnly)
 * until someone re-approved it. The log keeps its APPROVED status; the save
 * is audited as `log_amend`.
 *
 * Deliberately NOT MANAGER — approving is theirs, un-approving after the
 * fact is admin/accounting. Hours already covered by a payroll payment stay
 * locked for everyone (see PaidEntriesLockedError).
 */
export function canAmendApprovedLog(role: RoleName): boolean {
  return role === "ADMIN" || role === "OFFICE_STAFF";
}

/** Who may edit log content (header, narrative, labor sheet) at a status. */
export function canEditLogAtStatus(
  status: LogStatus,
  role: RoleName,
  access: FieldAccess,
): boolean {
  if (access !== "write") return false;
  if (status === "DRAFT") return true;
  if (status === "SUBMITTED") return role === "ADMIN" || role === "MANAGER";
  return canAmendApprovedLog(role); // APPROVED: frozen except for amenders
}

export function canApproveLog(role: RoleName): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function canReturnLog(role: RoleName): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function canReopenLog(role: RoleName): boolean {
  return role === "ADMIN";
}

export function canDeleteLog(status: LogStatus, role: RoleName, access: FieldAccess): boolean {
  if (status === "DRAFT") return access === "write";
  return role === "ADMIN";
}
