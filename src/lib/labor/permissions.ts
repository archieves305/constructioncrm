import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

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

const OFFICE_ROLES: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

/** Create/edit personnel records (non-sensitive fields). */
export function canManagePersonnel(role: RoleName): boolean {
  return OFFICE_ROLES.includes(role);
}

/** See the roster at all (CREW_LEAD/READ_ONLY get a reduced field set). */
export function canReadPersonnel(role: RoleName): boolean {
  return OFFICE_ROLES.includes(role) || role === "CREW_LEAD" || role === "READ_ONLY";
}

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
