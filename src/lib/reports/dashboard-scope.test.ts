import { describe, expect, it } from "vitest";
import { leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { dashboardLeadWhere, dashboardTaskWhere } from "./dashboard-scope";

describe("dashboardLeadWhere", () => {
  it("is undefined for all with no dates", () => {
    expect(dashboardLeadWhere({ scope: "all", userId: "u" })).toBeUndefined();
    expect(dashboardLeadWhere({ dateFilter: {}, scope: "all", userId: "u" })).toBeUndefined();
  });
  it("is just the date window for all", () => {
    expect(dashboardLeadWhere({ dateFilter: { gte: new Date("2026-01-01") }, scope: "all", userId: "u" })).toEqual({ createdAt: { gte: new Date("2026-01-01") } });
  });
  it("adds involvement for mine, ANDed with the window", () => {
    expect(dashboardLeadWhere({ scope: "mine", userId: "u" })).toEqual(leadsInvolvingUserWhere("u"));
    expect(dashboardLeadWhere({ dateFilter: { lte: new Date("2026-02-01") }, scope: "mine", userId: "u" })).toEqual({
      AND: [{ createdAt: { lte: new Date("2026-02-01") } }, leadsInvolvingUserWhere("u")],
    });
  });
});

describe("dashboardTaskWhere", () => {
  it("scopes to my assignments only for mine", () => {
    expect(dashboardTaskWhere({ scope: "mine", userId: "u" })).toEqual({ assignedUserId: "u" });
    expect(dashboardTaskWhere({ scope: "all", userId: "u" })).toEqual({});
  });
});
