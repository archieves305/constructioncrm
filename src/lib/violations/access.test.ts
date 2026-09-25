import { describe, expect, it } from "vitest";
import {
  canCloseCase,
  canConfirmAgency,
  canCreateCase,
  canEditCase,
  canOverrideClosure,
  canOverrideFines,
  canViewCase,
  canViewFinancials,
  toJobScope,
  violationVisibilityFilter,
  type CaseScope,
} from "./access";

const empty: CaseScope = { caseManagerId: null, itemAssigneeIds: [], taskAssigneeIds: [], teamUserIds: [] };
const onIt: CaseScope = { ...empty, caseManagerId: "u-cm", itemAssigneeIds: ["u-item"], taskAssigneeIds: ["u-task"], teamUserIds: ["u-slot"] };
const u = (id: string, role: Parameters<typeof canViewCase>[0]["role"]) => ({ id, role });

describe("violation access", () => {
  it("office roles and READ_ONLY see everything; own-only roles only cases they are on", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"] as const) {
      expect(canViewCase(u("x", role), empty), role).toBe(true);
      expect(violationVisibilityFilter(u("x", role)), role).toEqual({});
    }
    for (const role of ["SALES_REP", "CREW_LEAD", "MARKETING"] as const) {
      expect(canViewCase(u("x", role), empty), role).toBe(false);
      for (const id of ["u-cm", "u-item", "u-task", "u-slot"]) expect(canViewCase(u(id, role), onIt), `${role} ${id}`).toBe(true);
      expect(violationVisibilityFilter(u("x", role))).toMatchObject({ OR: expect.any(Array) });
    }
  });

  it("editing: office always; own-only only on their cases; READ_ONLY never", () => {
    expect(canEditCase(u("x", "OFFICE_STAFF"), empty)).toBe(true);
    expect(canEditCase(u("u-item", "SALES_REP"), onIt)).toBe(true);
    expect(canEditCase(u("x", "SALES_REP"), onIt)).toBe(false);
    expect(canEditCase(u("u-cm", "READ_ONLY"), onIt)).toBe(false);
  });

  it("creating is an office action; confirmation, closure and overrides are ADMIN/MANAGER only", () => {
    expect(canCreateCase("OFFICE_STAFF")).toBe(true);
    expect(canCreateCase("SALES_REP")).toBe(false);
    for (const role of ["ADMIN", "MANAGER"] as const) {
      expect(canConfirmAgency(role)).toBe(true);
      expect(canCloseCase(role)).toBe(true);
      expect(canOverrideClosure(role)).toBe(true);
      expect(canOverrideFines(role)).toBe(true);
    }
    for (const role of ["OFFICE_STAFF", "SALES_REP", "READ_ONLY"] as const) {
      expect(canConfirmAgency(role), role).toBe(false);
      expect(canCloseCase(role), role).toBe(false);
      expect(canOverrideClosure(role), role).toBe(false);
      expect(canOverrideFines(role), role).toBe(false);
    }
  });

  it("financials follow visibility; the case manager maps to the PM slot for the workflow helpers", () => {
    expect(canViewFinancials(u("u-cm", "CREW_LEAD"), onIt)).toBe(true);
    expect(canViewFinancials(u("x", "CREW_LEAD"), onIt)).toBe(false);
    expect(toJobScope(onIt)).toEqual({ projectManagerId: "u-cm", teamUserIds: ["u-slot"], fieldUserIds: [] });
  });
});
