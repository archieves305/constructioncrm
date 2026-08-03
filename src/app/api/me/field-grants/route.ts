import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  canEditPayRates,
  canSeeLaborCosts,
  canViewPayroll,
  canViewSensitivePersonnel,
  getFieldGrants,
} from "@/lib/labor/permissions";
import {
  canApproveJobCosts,
  canDeleteExpense,
  canEnterJobCosts,
  getCostGrants,
} from "@/lib/expenses/permissions";

// Effective field-module capabilities for the signed-in user (role + DB
// grants combined). Drives edit affordances client-side; the APIs enforce
// the same rules server-side regardless.
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const [grants, costGrants] = await Promise.all([
    getFieldGrants(session.user.id),
    getCostGrants(session.user.id),
  ]);
  return NextResponse.json({
    canViewSensitivePersonnel: canViewSensitivePersonnel(session.user.role, grants),
    canEditPayRates: canEditPayRates(session.user.role, grants),
    canViewPayrollReports: canViewPayroll(session.user.role, grants),
    canSeeLaborCosts: canSeeLaborCosts(session.user.role),
    canEnterJobCosts: canEnterJobCosts(session.user.role, costGrants),
    // Approval is role-only — the enter grant deliberately does not confer it.
    canApproveJobCosts: canApproveJobCosts(session.user.role),
    // Allocator-sourced rows are cc-allocator's record; only ADMIN may remove
    // one from this side, and even then it desyncs the two systems.
    canDeleteAllocatorCharges: canDeleteExpense(session.user.role, costGrants, {
      externalId: "any",
    }),
  });
}
