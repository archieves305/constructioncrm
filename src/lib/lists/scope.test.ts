import { describe, expect, it } from "vitest";
import { resolveTaskScope, taskAssigneeFor } from "./scope";
import type { RoleName } from "@/generated/prisma/enums";
import { effectiveListScope, isScopeForced, parseListScope, resolveClientScope, scopeToPref } from "./scope";

const ROLES: RoleName[] = ["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY", "CREW_LEAD"];

describe("parseListScope", () => {
  it("accepts only the two values", () => {
    expect(parseListScope("mine")).toBe("mine");
    expect(parseListScope("all")).toBe("all");
    expect(parseListScope("ALL")).toBeUndefined();
    expect(parseListScope("")).toBeUndefined();
    expect(parseListScope(null)).toBeUndefined();
  });
});

describe("effectiveListScope", () => {
  it("defaults to all for unfloored roles and honours a request", () => {
    for (const role of ROLES.filter((r) => !isScopeForced(r))) {
      expect(effectiveListScope(undefined, role)).toBe("all");
      expect(effectiveListScope("mine", role)).toBe("mine");
      expect(effectiveListScope("all", role)).toBe("all");
    }
  });
  it("pins SALES_REP and CREW_LEAD to mine even when they ask for all", () => {
    for (const role of ["SALES_REP", "CREW_LEAD"] as RoleName[]) {
      expect(isScopeForced(role)).toBe(true);
      expect(effectiveListScope(undefined, role)).toBe("mine");
      expect(effectiveListScope("all", role)).toBe("mine");
    }
  });
  it("leaves MARKETING unfloored", () => {
    expect(isScopeForced("MARKETING")).toBe(false);
  });
});

describe("resolveClientScope", () => {
  it("prefers the URL, then the saved preference, then MINE", () => {
    expect(resolveClientScope({ url: "all", pref: "MINE", role: "ADMIN" })).toBe("all");
    expect(resolveClientScope({ url: null, pref: "ALL", role: "ADMIN" })).toBe("all");
    expect(resolveClientScope({ url: "garbage", pref: "ALL", role: "ADMIN" })).toBe("all");
    expect(resolveClientScope({ url: null, pref: null, role: "ADMIN" })).toBe("mine");
    expect(resolveClientScope({})).toBe("mine");
  });
  it("ignores both for a floored role", () => {
    expect(resolveClientScope({ url: "all", pref: "ALL", role: "SALES_REP" })).toBe("mine");
  });
  it("maps a scope back to the stored preference", () => {
    expect(scopeToPref("all")).toBe("ALL");
    expect(scopeToPref("mine")).toBe("MINE");
  });
});

describe("resolveTaskScope / taskAssigneeFor", () => {
  it("the Tasks page defaults to Mine, follows the URL then the preference, with no role floor", () => {
    expect(resolveTaskScope({ url: null, pref: null })).toBe("mine");
    expect(resolveTaskScope({ url: null, pref: "ALL" })).toBe("all");
    expect(resolveTaskScope({ url: "all", pref: "MINE" })).toBe("all");
    expect(resolveTaskScope({ url: "junk", pref: "ALL" })).toBe("all");
  });
  it("an explicit assignee wins; Mine is the signed-in person; Everyone is no filter", () => {
    expect(taskAssigneeFor({ explicit: "u2", scope: "mine", userId: "u1" })).toBe("u2");
    expect(taskAssigneeFor({ explicit: "me", scope: "all", userId: "u1" })).toBe("u1");
    expect(taskAssigneeFor({ explicit: null, scope: "mine", userId: "u1" })).toBe("u1");
    expect(taskAssigneeFor({ explicit: null, scope: "mine", userId: null })).toBe("me");
    expect(taskAssigneeFor({ explicit: null, scope: "all", userId: "u1" })).toBe("");
  });
});
