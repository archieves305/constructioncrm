import type { ContactRole, OrganizationKind, PartnerStage, Prisma, RoleName } from "@/generated/prisma/client";
import { parseListScope, type ListScope } from "@/lib/lists/scope";
import { isPartnerStage } from "./stages";

/**
 * The account and contact list `where`s, built from query params in one
 * pure function (the leads/jobs pattern), so ⌘K and the list pages agree.
 * "Mine" on an account list means accounts I own — a convenience filter,
 * not a floor: every viewing role sees every account (seven users today).
 */
export type OrgSort = "name" | "lastContact" | "stage";

export type OrgListParams = {
  search?: string;
  stage?: PartnerStage;
  ownerUserId?: string;
  market?: string;
  tradeId?: string;
  kind?: OrganizationKind;
  includeInactive?: boolean;
  scope?: ListScope;
  sort?: OrgSort;
  page: number;
  pageSize: number;
};

export type OrgListContext = { user: { id: string; role: RoleName } };

const KINDS: readonly string[] = ["GENERAL_CONTRACTOR", "DEVELOPER", "PROPERTY_MANAGER", "ARCHITECT", "ENGINEER", "MUNICIPALITY", "REFERRAL_PARTNER", "OTHER"];

export function parseOrgListParams(sp: URLSearchParams): OrgListParams {
  const s = (k: string) => sp.get(k)?.trim() || undefined;
  const stage = s("stage");
  const kind = s("kind");
  const sort = s("sort");
  return {
    search: s("search") ?? s("q"),
    stage: isPartnerStage(stage) ? stage : undefined,
    ownerUserId: s("owner"),
    market: s("market"),
    tradeId: s("trade"),
    kind: kind && KINDS.includes(kind) ? (kind as OrganizationKind) : undefined,
    includeInactive: sp.get("inactive") === "1",
    scope: parseListScope(sp.get("scope")),
    sort: sort === "name" || sort === "lastContact" || sort === "stage" ? sort : undefined,
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(500, Math.max(1, Number(sp.get("pageSize")) || 50)),
  };
}

export function buildOrgListWhere(p: OrgListParams, ctx: OrgListContext): Prisma.OrganizationWhereInput {
  const and: Prisma.OrganizationWhereInput[] = [];
  if (!p.includeInactive) and.push({ isActive: true });
  if (p.search) {
    const q = p.search;
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { website: { contains: q, mode: "insensitive" } },
        { contacts: { some: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } },
      ],
    });
  }
  if (p.stage) and.push({ stage: p.stage });
  if (p.kind) and.push({ kind: p.kind });
  if (p.ownerUserId) and.push({ ownerUserId: p.ownerUserId });
  if (p.market) and.push({ markets: { has: p.market } });
  if (p.tradeId) and.push({ trades: { some: { serviceCategoryId: p.tradeId } } });
  if (p.scope === "mine") and.push({ ownerUserId: ctx.user.id });
  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

export function orgOrderBy(sort: OrgSort | undefined): Prisma.OrganizationOrderByWithRelationInput[] {
  switch (sort) {
    case "lastContact":
      return [{ lastContactAt: { sort: "desc", nulls: "last" } }, { name: "asc" }];
    case "stage":
      return [{ stage: "asc" }, { name: "asc" }];
    default:
      return [{ name: "asc" }];
  }
}

export type ContactListParams = {
  search?: string;
  organizationId?: string;
  roleTag?: ContactRole;
  geography?: string;
  trade?: string;
  ownerUserId?: string;
  /** Contacts not touched since this day (yyyy-MM-dd), or never. */
  quietSince?: string;
  includeInactive?: boolean;
  page: number;
  pageSize: number;
};

const ROLE_TAGS: readonly string[] = ["ESTIMATOR", "SENIOR_ESTIMATOR", "PRECON_MANAGER", "PRECON_DIRECTOR", "PROCUREMENT", "TRADE_PARTNER_MANAGER", "BUSINESS_DEVELOPMENT", "PROJECT_EXECUTIVE", "PROJECT_MANAGER", "SUPERINTENDENT", "ACCOUNTS_PAYABLE", "SAFETY", "OTHER"];

export function parseContactListParams(sp: URLSearchParams): ContactListParams {
  const s = (k: string) => sp.get(k)?.trim() || undefined;
  const roleTag = s("role");
  const quiet = s("quietSince");
  return {
    search: s("search") ?? s("q"),
    organizationId: s("organizationId"),
    roleTag: roleTag && ROLE_TAGS.includes(roleTag) ? (roleTag as ContactRole) : undefined,
    geography: s("geography"),
    trade: s("trade"),
    ownerUserId: s("owner"),
    quietSince: quiet && /^\d{4}-\d{2}-\d{2}$/.test(quiet) ? quiet : undefined,
    includeInactive: sp.get("inactive") === "1",
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(500, Math.max(1, Number(sp.get("pageSize")) || 50)),
  };
}

export function buildContactListWhere(p: ContactListParams): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  if (!p.includeInactive) and.push({ isActive: true, organization: { isActive: true } });
  if (p.search) {
    const q = p.search;
    and.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { organization: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (p.organizationId) and.push({ organizationId: p.organizationId });
  if (p.roleTag) and.push({ roleTag: p.roleTag });
  if (p.geography) and.push({ geography: { contains: p.geography, mode: "insensitive" } });
  if (p.trade) and.push({ trades: { has: p.trade } });
  if (p.ownerUserId) and.push({ organization: { ownerUserId: p.ownerUserId } });
  if (p.quietSince) and.push({ OR: [{ lastContactAt: null }, { lastContactAt: { lt: new Date(`${p.quietSince}T12:00:00.000Z`) } }] });
  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}
