import { describe, expect, it } from "vitest";
import { buildContactListWhere, buildOrgListWhere, orgOrderBy, parseContactListParams, parseOrgListParams } from "./query";

const admin = { user: { id: "u1", role: "ADMIN" as const } };
const rep = { user: { id: "u2", role: "SALES_REP" as const } };

describe("organization list where", () => {
  it("hides inactive accounts by default and shows them on request", () => {
    expect(buildOrgListWhere(parseOrgListParams(new URLSearchParams()), admin)).toEqual({ isActive: true });
    expect(buildOrgListWhere(parseOrgListParams(new URLSearchParams("inactive=1")), admin)).toEqual({});
  });

  it("parses and applies every filter", () => {
    const p = parseOrgListParams(new URLSearchParams("stage=ENGAGED&kind=DEVELOPER&owner=u9&market=Broward&trade=t1&search=moss&sort=lastContact&page=2&pageSize=20"));
    expect(p).toMatchObject({ stage: "ENGAGED", kind: "DEVELOPER", ownerUserId: "u9", market: "Broward", tradeId: "t1", search: "moss", sort: "lastContact", page: 2, pageSize: 20 });
    const where = buildOrgListWhere(p, admin);
    expect(where.AND).toEqual(
      expect.arrayContaining([{ stage: "ENGAGED" }, { kind: "DEVELOPER" }, { ownerUserId: "u9" }, { markets: { has: "Broward" } }, { trades: { some: { serviceCategoryId: "t1" } } }]),
    );
  });

  it("ignores unknown stage and kind values", () => {
    const p = parseOrgListParams(new URLSearchParams("stage=WON&kind=BANK"));
    expect(p.stage).toBeUndefined();
    expect(p.kind).toBeUndefined();
  });

  it("Mine = accounts I own; nobody is floored to Mine", () => {
    const mine = buildOrgListWhere(parseOrgListParams(new URLSearchParams("scope=mine")), admin);
    expect(mine.AND).toEqual(expect.arrayContaining([{ ownerUserId: "u1" }]));
    expect(buildOrgListWhere(parseOrgListParams(new URLSearchParams("scope=all")), rep)).toEqual({ isActive: true });
  });

  it("orders by name, last contact (nulls last) or stage", () => {
    expect(orgOrderBy(undefined)).toEqual([{ name: "asc" }]);
    expect(orgOrderBy("lastContact")[0]).toEqual({ lastContactAt: { sort: "desc", nulls: "last" } });
    expect(orgOrderBy("stage")[0]).toEqual({ stage: "asc" });
  });
});

describe("contact list where", () => {
  it("defaults to active people at active accounts", () => {
    expect(buildContactListWhere(parseContactListParams(new URLSearchParams()))).toEqual({ isActive: true, organization: { isActive: true } });
  });

  it("applies role, geography, trade, owner and quiet-since", () => {
    const p = parseContactListParams(new URLSearchParams("role=ESTIMATOR&geography=Miami&trade=Roofing&owner=u3&quietSince=2026-08-01&organizationId=o1"));
    const where = buildContactListWhere(p);
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { organizationId: "o1" },
        { roleTag: "ESTIMATOR" },
        { geography: { contains: "Miami", mode: "insensitive" } },
        { trades: { has: "Roofing" } },
        { organization: { ownerUserId: "u3" } },
        { OR: [{ lastContactAt: null }, { lastContactAt: { lt: new Date("2026-08-01T12:00:00.000Z") } }] },
      ]),
    );
  });

  it("drops a malformed quietSince and an unknown role", () => {
    const p = parseContactListParams(new URLSearchParams("quietSince=yesterday&role=CEO"));
    expect(p.quietSince).toBeUndefined();
    expect(p.roleTag).toBeUndefined();
  });
});
