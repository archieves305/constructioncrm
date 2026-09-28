import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/enums";
import { seesAllTasks } from "@/lib/tasks/access";
import { canDispatch, canScheduleTask, canViewAllCalendars, canViewCalendarOf, coerceUsersParam, usersParamOf } from "./access";

const ROLES: RoleName[] = ["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY", "CREW_LEAD"];

describe("calendar access", () => {
  it("dispatch is exactly the three office roles", () => {
    expect(ROLES.filter(canDispatch)).toEqual(["ADMIN", "MANAGER", "OFFICE_STAFF"]);
    expect(canDispatch(null)).toBe(false);
  });

  it("viewing everyone follows the task visibility rule for every role", () => {
    for (const r of ROLES) expect(canViewAllCalendars(r)).toBe(seesAllTasks(r));
  });

  it("anyone may view their own calendar; only view-all roles see another person's", () => {
    for (const r of ROLES) {
      expect(canViewCalendarOf({ id: "u1", role: r }, "u1")).toBe(true);
      expect(canViewCalendarOf({ id: "u1", role: r }, "u2")).toBe(seesAllTasks(r));
    }
  });

  it("scheduling is editing: own-only roles on their own tasks, office roles on any, READ_ONLY never", () => {
    const own = { assignedUserId: "u1", createdByUserId: "u9" };
    const other = { assignedUserId: "u2", createdByUserId: "u9" };
    expect(canScheduleTask({ id: "u1", role: "SALES_REP" }, own)).toBe(true);
    expect(canScheduleTask({ id: "u1", role: "SALES_REP" }, other)).toBe(false);
    expect(canScheduleTask({ id: "u1", role: "OFFICE_STAFF" }, other)).toBe(true);
    expect(canScheduleTask({ id: "u1", role: "READ_ONLY" }, own)).toBe(false);
  });
});

describe("coerceUsersParam", () => {
  it("floors own-only roles to `me` whatever they ask for — MARKETING included", () => {
    for (const r of ["SALES_REP", "CREW_LEAD", "MARKETING"] as RoleName[]) {
      expect(coerceUsersParam("all", r)).toEqual({ kind: "me" });
      expect(coerceUsersParam("u2,u3", r)).toEqual({ kind: "me" });
      expect(coerceUsersParam("unassigned", r)).toEqual({ kind: "me" });
    }
  });

  it("parses me / all / ids / unassigned for view-all roles", () => {
    expect(coerceUsersParam(null, "ADMIN")).toEqual({ kind: "me" });
    expect(coerceUsersParam("", "ADMIN")).toEqual({ kind: "me" });
    expect(coerceUsersParam("me", "READ_ONLY")).toEqual({ kind: "me" });
    expect(coerceUsersParam("all", "MANAGER")).toEqual({ kind: "all" });
    expect(coerceUsersParam("u2, u3,u2", "OFFICE_STAFF")).toEqual({ kind: "ids", ids: ["u2", "u3"], includeUnassigned: false });
    expect(coerceUsersParam("u2,unassigned", "ADMIN")).toEqual({ kind: "ids", ids: ["u2"], includeUnassigned: true });
    expect(coerceUsersParam("unassigned", "ADMIN")).toEqual({ kind: "ids", ids: [], includeUnassigned: true });
    expect(coerceUsersParam(",,", "ADMIN")).toEqual({ kind: "me" });
  });

  it("round-trips through usersParamOf", () => {
    for (const raw of ["me", "all", "u2,u3", "u2,unassigned", "unassigned"]) {
      expect(usersParamOf(coerceUsersParam(raw, "ADMIN"))).toBe(raw);
    }
  });
});
