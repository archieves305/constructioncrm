import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Who may put money on a job.
 *
 * This exists because the expense endpoints had NO role check at all: any
 * authenticated user — including READ_ONLY and MARKETING — could create, edit
 * or delete a job expense. That is not a soft record: a `billable` expense
 * increments `job.contractAmount` and recomputes `balanceDue`, so the hole
 * let anyone with a login change what a customer owes.
 *
 * Explicit role lists, never `hasMinRole`. The numeric hierarchy ranks
 * SALES_REP (60) ABOVE OFFICE_STAFF (50) — and OFFICE_STAFF is Accounting —
 * so a "minimum role" check would hand sales more financial authority than
 * the bookkeepers. `lib/labor/permissions.ts` carries the same warning for
 * the same reason.
 */

/** Office/accounting. These roles enter job costs as part of the job. */
const COST_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

export type CostGrants = { canEnterJobCosts: boolean };

export const NO_COST_GRANTS: CostGrants = { canEnterJobCosts: false };

/**
 * Read fresh from the DB rather than the session, so revoking the grant takes
 * effect on the next request instead of the next login — matching how the
 * field-module grants behave.
 */
export async function getCostGrants(userId: string): Promise<CostGrants> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canEnterJobCosts: true },
  });
  return user ?? NO_COST_GRANTS;
}

/**
 * Add a charge to a job, or amend one.
 *
 * The grant is the escape hatch for the PM or crew lead who genuinely buys
 * materials — without it, the only way to let one person file a receipt is to
 * make them a MANAGER, which grants far more than intended.
 */
export function canEnterJobCosts(role: RoleName, grants: CostGrants): boolean {
  return COST_ROLES.includes(role) || grants.canEnterJobCosts;
}

/**
 * Delete a job expense.
 *
 * Expenses carrying an `externalId` belong to cc-allocator — that id is its
 * Transaction id and the CRM's idempotency key. Deleting one does not undo
 * anything upstream; it just makes the two systems disagree, and because the
 * idempotency check then finds nothing, a later retry silently re-creates it.
 * So allocator-sourced rows are ADMIN-only, and the caller should be steering
 * people to fix the record in cc-allocator instead.
 */
export function canDeleteExpense(
  role: RoleName,
  grants: CostGrants,
  expense: { externalId: string | null },
): boolean {
  if (expense.externalId) return role === "ADMIN";
  return canEnterJobCosts(role, grants);
}

/** Human-readable refusal, so the UI does not have to invent one. */
export const COST_DENIED_MESSAGE =
  "You do not have permission to change job costs. Ask an admin for the 'Enter job costs' grant.";

export const ALLOCATOR_DELETE_MESSAGE =
  "This charge came from cc-allocator. Remove or re-code it there — deleting it here only makes the two systems disagree.";
