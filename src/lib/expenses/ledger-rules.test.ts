import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import { canApproveJobCosts, canEnterJobCosts, NO_COST_GRANTS } from "./permissions";

/**
 * The ledger rule, extracted so the arithmetic that decides whether a charge
 * moves money is testable without a database.
 *
 * This mirrors the delta computation in PATCH /api/expenses/[id] and the
 * increment decisions in POST /api/jobs/[id]/expenses and the review route.
 * The invariant they all share: **only an APPROVED charge contributes.**
 */
type Status = "PENDING" | "APPROVED" | "REJECTED";

function contribution(input: {
  status: Status;
  billable: boolean;
  amount: number;
  isRollup: boolean;
}): number {
  if (input.status !== "APPROVED") return 0;
  if (input.isRollup) return 0; // rollup contracts are recomputed, not incremented
  return input.billable ? input.amount : 0;
}

function delta(
  before: { status: Status; billable: boolean; amount: number },
  after: { status: Status; billable: boolean; amount: number },
  isRollup: boolean,
): number {
  return (
    contribution({ ...after, isRollup }) - contribution({ ...before, isRollup })
  );
}

const billable = (status: Status, amount = 100) => ({ status, billable: true, amount });

describe("ledger contribution", () => {
  it("counts an approved billable charge", () => {
    expect(contribution({ ...billable("APPROVED"), isRollup: false })).toBe(100);
  });

  it("counts nothing for a pending charge", () => {
    // The whole point: an unreviewed charge cannot change what a customer owes.
    expect(contribution({ ...billable("PENDING"), isRollup: false })).toBe(0);
  });

  it("counts nothing for a rejected charge", () => {
    expect(contribution({ ...billable("REJECTED"), isRollup: false })).toBe(0);
  });

  it("counts nothing for a non-billable charge even when approved", () => {
    expect(
      contribution({ status: "APPROVED", billable: false, amount: 100, isRollup: false }),
    ).toBe(0);
  });

  it("never increments on rollup jobs — those recompute instead", () => {
    expect(contribution({ ...billable("APPROVED"), isRollup: true })).toBe(0);
  });
});

describe("ledger delta on transitions", () => {
  it("applies the full amount when a pending charge is approved", () => {
    expect(delta(billable("PENDING"), billable("APPROVED"), false)).toBe(100);
  });

  it("applies nothing when a pending charge is rejected", () => {
    expect(delta(billable("PENDING"), billable("REJECTED"), false)).toBe(0);
  });

  it("is free to edit a pending charge's amount", () => {
    // Contributes zero on both sides, so no special-casing is needed in PATCH.
    expect(delta(billable("PENDING", 100), billable("PENDING", 5000), false)).toBe(0);
  });

  it("still tracks edits to an approved charge", () => {
    expect(delta(billable("APPROVED", 100), billable("APPROVED", 175), false)).toBe(75);
  });

  it("reverses when an approved billable charge is deleted", () => {
    const gone = { status: "APPROVED" as Status, billable: true, amount: 0 };
    expect(delta(billable("APPROVED", 100), gone, false)).toBe(-100);
  });

  it("does NOT reverse when a pending charge is deleted", () => {
    // Decrementing here would silently reduce what the customer owes for a
    // charge that was never added in the first place.
    const gone = { status: "PENDING" as Status, billable: true, amount: 0 };
    expect(delta(billable("PENDING", 100), gone, false)).toBe(0);
  });

  it("applies the amount when approval and a billable flip happen together", () => {
    expect(
      delta(
        { status: "PENDING", billable: false, amount: 100 },
        { status: "APPROVED", billable: true, amount: 100 },
        false,
      ),
    ).toBe(100);
  });
});

describe("entry and approval are separate capabilities", () => {
  it("gives approval to the office roles only", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF"] as RoleName[]) {
      expect(canApproveJobCosts(role)).toBe(true);
    }
    for (const role of ["SALES_REP", "CREW_LEAD", "MARKETING", "READ_ONLY"] as RoleName[]) {
      expect(canApproveJobCosts(role)).toBe(false);
    }
  });

  it("does not let the enter-costs grant confer approval", () => {
    // Otherwise the grant-holder files and clears their own charge, and the
    // queue is decorative.
    const granted = { canEnterJobCosts: true };
    expect(canEnterJobCosts("CREW_LEAD", granted)).toBe(true);
    expect(canApproveJobCosts("CREW_LEAD")).toBe(false);
  });

  it("means an approver's own entry needs no second pair of hands", () => {
    // Auto-approve-on-entry is only sound because these roles could approve
    // it a second later anyway.
    expect(canEnterJobCosts("OFFICE_STAFF", NO_COST_GRANTS)).toBe(true);
    expect(canApproveJobCosts("OFFICE_STAFF")).toBe(true);
  });
});
