import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  canEditPayRates,
  canSeeLaborCosts,
  canViewPayroll,
  canViewSensitivePersonnel,
  getFieldGrants,
} from "@/lib/labor/permissions";

// Effective field-module capabilities for the signed-in user (role + DB
// grants combined). Drives edit affordances client-side; the APIs enforce
// the same rules server-side regardless.
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const grants = await getFieldGrants(session.user.id);
  return NextResponse.json({
    canViewSensitivePersonnel: canViewSensitivePersonnel(session.user.role, grants),
    canEditPayRates: canEditPayRates(session.user.role, grants),
    canViewPayrollReports: canViewPayroll(session.user.role, grants),
    canSeeLaborCosts: canSeeLaborCosts(session.user.role),
  });
}
