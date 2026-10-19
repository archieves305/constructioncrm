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
    expect(buildLeadListWhere({}, admin)).toEqual({ AND: [{ kind: "CUSTOMER" }, { currentStage: { isClosed: false } }] });
    expect(clauses(buildLeadListWhere({ stageId: "won" }, admin))).not.toContainEqual({ currentStage: { isClosed: false } });
    expect(buildLeadListWhere({ includeClosed: true }, admin)).toEqual({ kind: "CUSTOMER" });
  });

  it("finds a lead by the number on one of its estimates, from either builder", () => {
    const w = JSON.stringify(buildLeadListWhere({ search: "EST-2026", includeClosed: true }, admin));
    expect(w).toContain('"estimates":{"some":{"estimateNumber"');
    expect(w).toContain('"roofEstimates":{"some":{"estimateNumber"');
  });

  it("searches across name, phone, email, address, company, estimate numbers and bid numbers", () => {
    const w = buildLeadListWhere({ search: "smith", includeClosed: true, kind: "ALL" }, admin);
    expect(w.OR).toHaveLength(8);
    expect(w.OR).toContainEqual({ bidInvitation: { OR: [{ number: { contains: "smith", mode: "insensitive" } }, { projectName: { contains: "smith", mode: "insensitive" } }] } });
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
    expect(clauses(buildLeadListWhere({ scope: "all" }, admin))).toHaveLength(2); // the kind fence + open stages
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

describe("the call list", () => {
  it("is open leads not Won, follow-up due by the cut-off or never contacted", () => {
    const before = new Date("2026-10-19T23:59:59-04:00");
    const where = buildLeadListWhere({ callListBefore: before }, admin) as { AND: unknown[] };
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { currentStage: { isWon: false } },
        { OR: [{ nextFollowUpAt: { lte: before } }, { lastContactAt: null }] },
      ]),
    );
  });
  it("is read from ?callList=1 as the end of today", () => {
    const p = parseLeadListParams(new URLSearchParams("callList=1"));
    expect(p.callListBefore).toBeInstanceOf(Date);
    expect(parseLeadListParams(new URLSearchParams("")).callListBefore).toBeUndefined();
  });
});

describe("the GC bid fence", () => {
  it("customer lists exclude bid packages unless asked", () => {
    expect(clauses(buildLeadListWhere({}, admin))).toContainEqual({ kind: "CUSTOMER" });
    expect(clauses(buildLeadListWhere(parseLeadListParams(new URLSearchParams("kind=GC_BID")), admin))).toContainEqual({ kind: "GC_BID" });
    const all = clauses(buildLeadListWhere(parseLeadListParams(new URLSearchParams("kind=ALL")), admin));
    expect(all.some((c) => "kind" in c)).toBe(false);
    expect(parseLeadListParams(new URLSearchParams("kind=BOGUS")).kind).toBeUndefined();
  });
});
