import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import {
  canDeleteExpense,
  canEnterJobCosts,
  NO_COST_GRANTS,
} from "./permissions";

const granted = { canEnterJobCosts: true };
const manual = { externalId: null };
const fromAllocator = { externalId: "txn_123" };

describe("canEnterJobCosts", () => {
  it("allows the office roles", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF"] as RoleName[]) {
      expect(canEnterJobCosts(role, NO_COST_GRANTS)).toBe(true);
    }
  });

  it("denies everyone else by default", () => {
    // Every one of these could previously create, edit and delete expenses —
    // and a billable expense changes what the customer owes.
    for (const role of [
      "SALES_REP",
      "MARKETING",
      "READ_ONLY",
      "CREW_LEAD",
    ] as RoleName[]) {
      expect(canEnterJobCosts(role, NO_COST_GRANTS)).toBe(false);
    }
  });

  it("does NOT let SALES_REP in via the role hierarchy", () => {
    // The guard against the obvious refactor: ROLE_HIERARCHY ranks SALES_REP
    // (60) above OFFICE_STAFF (50), so `hasMinRole(role, "OFFICE_STAFF")`
    // would silently grant sales more financial authority than accounting.
    expect(canEnterJobCosts("SALES_REP", NO_COST_GRANTS)).toBe(false);
    expect(canEnterJobCosts("OFFICE_STAFF", NO_COST_GRANTS)).toBe(true);
  });

  it("lets the grant promote an otherwise-denied role", () => {
    // The PM or crew lead who genuinely buys materials, without having to be
    // made a MANAGER to file a receipt.
    expect(canEnterJobCosts("CREW_LEAD", granted)).toBe(true);
    expect(canEnterJobCosts("SALES_REP", granted)).toBe(true);
  });

  it("lets the grant promote even READ_ONLY, since it is explicit", () => {
    expect(canEnterJobCosts("READ_ONLY", granted)).toBe(true);
  });
});

describe("canDeleteExpense", () => {
  it("follows the entry rule for manually-created expenses", () => {
    expect(canDeleteExpense("OFFICE_STAFF", NO_COST_GRANTS, manual)).toBe(true);
    expect(canDeleteExpense("SALES_REP", NO_COST_GRANTS, manual)).toBe(false);
    expect(canDeleteExpense("SALES_REP", granted, manual)).toBe(true);
  });

  it("restricts allocator-sourced expenses to ADMIN", () => {
    // externalId is cc-allocator's Transaction id and the CRM's idempotency
    // key. Deleting the row does not undo anything upstream; it just makes
    // the two systems disagree, and a later retry re-creates it.
    expect(canDeleteExpense("ADMIN", NO_COST_GRANTS, fromAllocator)).toBe(true);
    expect(canDeleteExpense("MANAGER", NO_COST_GRANTS, fromAllocator)).toBe(false);
    expect(canDeleteExpense("OFFICE_STAFF", NO_COST_GRANTS, fromAllocator)).toBe(false);
  });

  it("does not let the grant override allocator ownership", () => {
    // The grant is about entering costs, not about overruling the system of
    // record for money that actually moved.
    expect(canDeleteExpense("CREW_LEAD", granted, fromAllocator)).toBe(false);
    expect(canDeleteExpense("MANAGER", granted, fromAllocator)).toBe(false);
  });
});
