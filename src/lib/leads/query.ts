import type { Prisma, RoleName } from "@/generated/prisma/client";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { effectiveListScope, parseListScope, type ListScope } from "@/lib/lists/scope";

/**
 * The leads-list `where`, built from query params in one pure function
 * (mirrors src/lib/jobs/query.ts). Every filter is ANDed: a sales rep's
 * floor no longer overwrites an explicit assignee filter, it narrows it.
 */
export type LeadListParams = {
  search?: string;
  stageId?: string;
  sourceId?: string;
  assignedUserId?: string;
  serviceCategoryId?: string;
  city?: string;
  county?: string;
  dateFrom?: string;
  dateTo?: string;
  includeClosed?: boolean;
  scope?: ListScope;
  /** Leads assigned to this person, or the customer of a job they have a role on. */
  involvesUserId?: string;
};

export type LeadListContext = { user: { id: string; role: RoleName } };

export function parseLeadListParams(searchParams: URLSearchParams): LeadListParams {
  const s = (k: string) => searchParams.get(k) || undefined;
  return {
    search: s("search"),
    stageId: s("stageId"),
    sourceId: s("sourceId"),
    assignedUserId: s("assignedUserId"),
    serviceCategoryId: s("serviceCategoryId"),
    city: s("city"),
    county: s("county"),
    dateFrom: s("dateFrom"),
    dateTo: s("dateTo"),
    includeClosed: searchParams.get("includeClosed") === "true",
    scope: parseListScope(searchParams.get("scope")),
    involvesUserId: s("involvesUserId"),
  };
}

export function buildLeadListWhere(params: LeadListParams, ctx: LeadListContext): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];

  // Closed stages are hidden unless asked for, or a specific stage is chosen.
  if (!params.includeClosed && !params.stageId) and.push({ currentStage: { isClosed: false } });

  if (params.search) {
    and.push({
      OR: [
        { fullName: { contains: params.search, mode: "insensitive" } },
        { primaryPhone: { contains: params.search } },
        { email: { contains: params.search, mode: "insensitive" } },
        { propertyAddress1: { contains: params.search, mode: "insensitive" } },
        { companyName: { contains: params.search, mode: "insensitive" } },
      ],
    });
  }

  if (params.stageId) and.push({ currentStageId: params.stageId });
  if (params.sourceId) and.push({ sourceId: params.sourceId });
  if (params.assignedUserId) and.push({ assignedUserId: params.assignedUserId });
  if (params.city) and.push({ city: { contains: params.city, mode: "insensitive" } });
  if (params.county) and.push({ county: { contains: params.county, mode: "insensitive" } });
  if (params.serviceCategoryId) and.push({ services: { some: { serviceCategoryId: params.serviceCategoryId } } });

  if (params.dateFrom || params.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (params.dateFrom) createdAt.gte = new Date(params.dateFrom);
    if (params.dateTo) createdAt.lte = new Date(params.dateTo);
    and.push({ createdAt });
  }

  if (effectiveListScope(params.scope, ctx.user.role) === "mine") and.push(leadsInvolvingUserWhere(ctx.user.id));
  if (params.involvesUserId) and.push(leadsInvolvingUserWhere(params.involvesUserId));

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

export { jobsInvolvingUserWhere };
