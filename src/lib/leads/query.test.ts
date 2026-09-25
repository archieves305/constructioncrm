import { describe, expect, it } from "vitest";
import { leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { buildLeadListWhere, parseLeadListParams } from "./query";

const admin = { user: { id: "admin", role: "ADMIN" as const } };
const rep = { user: { id: "rep", role: "SALES_REP" as const } };

function clauses(where: ReturnType<typeof buildLeadListWhere>) {
  return "AND" in where && Array.isArray(where.AND) ? where.AND : [where];
}

describe("parseLeadListParams", () => {
  it("reads every filter and treats blanks as absent", () => {
    const p = parseLeadListParams(new URLSearchParams("search=jo&stageId=s1&includeClosed=true&scope=mine&involvesUserId=u2&assignedUserId="));
    expect(p).toMatchObject({ search: "jo", stageId: "s1", includeClosed: true, scope: "mine", involvesUserId: "u2" });
    expect(p.assignedUserId).toBeUndefined();
    expect(parseLeadListParams(new URLSearchParams("scope=nope")).scope).toBeUndefined();
  });
});

describe("buildLeadListWhere", () => {
  it("hides closed stages by default, but not when a stage is chosen or closed are included", () => {
    expect(buildLeadListWhere({}, admin)).toEqual({ currentStage: { isClosed: false } });
    expect(clauses(buildLeadListWhere({ stageId: "won" }, admin))).not.toContainEqual({ currentStage: { isClosed: false } });
    expect(buildLeadListWhere({ includeClosed: true }, admin)).toEqual({});
  });

  it("searches across name, phone, email, address and company", () => {
    const w = buildLeadListWhere({ search: "smith", includeClosed: true }, admin);
    expect(w.OR).toHaveLength(5);
  });

  it("ANDs every filter", () => {
    const w = buildLeadListWhere({ stageId: "s1", sourceId: "src", assignedUserId: "u9", city: "Fort", dateFrom: "2026-01-01", dateTo: "2026-02-01" }, admin);
    const c = clauses(w);
    expect(c).toContainEqual({ currentStageId: "s1" });
    expect(c).toContainEqual({ sourceId: "src" });
    expect(c).toContainEqual({ assignedUserId: "u9" });
    expect(c).toContainEqual({ city: { contains: "Fort", mode: "insensitive" } });
    expect(c).toContainEqual({ createdAt: { gte: new Date("2026-01-01"), lte: new Date("2026-02-01") } });
  });

  it("admin: scope=all adds nothing, scope=mine adds involvement", () => {
    expect(clauses(buildLeadListWhere({ scope: "all" }, admin))).toHaveLength(1);
    expect(clauses(buildLeadListWhere({ scope: "mine" }, admin))).toContainEqual(leadsInvolvingUserWhere("admin"));
  });

  it("sales rep: floored to involvement even for scope=all, and an explicit assignee narrows instead of being overwritten", () => {
    const w = buildLeadListWhere({ scope: "all", assignedUserId: "other" }, rep);
    const c = clauses(w);
    expect(c).toContainEqual(leadsInvolvingUserWhere("rep"));
    expect(c).toContainEqual({ assignedUserId: "other" });
  });

  it("involvesUserId filters by another person's involvement", () => {
    expect(clauses(buildLeadListWhere({ involvesUserId: "pm" }, admin))).toContainEqual(leadsInvolvingUserWhere("pm"));
  });
});
