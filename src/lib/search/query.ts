import type { Prisma, RoleName } from "@/generated/prisma/client";
import { buildJobListWhere } from "@/lib/jobs/query";
import { buildLeadListWhere } from "@/lib/leads/query";
import { prospectVisibilityWhere } from "@/lib/prospects/access";
import { buildViolationListWhere, parseViolationListParams } from "@/lib/violations/query";

/**
 * The ⌘K search reuses the list builders, so a search hit is exactly a row
 * the same person would see on the list page: the sales-rep floor on jobs
 * and leads, the visibility filter on cases, the assignment rule on
 * prospects. Nothing here decides access on its own.
 */
export type SearchContext = { user: { id: string; role: RoleName }; now: Date };

export type SearchWheres = {
  jobs: Prisma.JobWhereInput;
  leads: Prisma.LeadWhereInput;
  cases: Prisma.CodeViolationCaseWhereInput;
  prospects: Prisma.ProspectWhereInput;
};

export function buildSearchWheres(q: string, ctx: SearchContext): SearchWheres {
  const search = q.trim();
  const caseParams = { ...parseViolationListParams(new URLSearchParams("view=all")), search };
  return {
    jobs: buildJobListWhere({ search }, ctx),
    leads: buildLeadListWhere({ search, includeClosed: true }, ctx),
    cases: buildViolationListWhere(caseParams, ctx),
    prospects: {
      AND: [
        prospectVisibilityWhere(ctx.user),
        {
          OR: [
            { propertyAddress1: { contains: search, mode: "insensitive" } },
            { ownerName: { contains: search, mode: "insensitive" } },
            { city: { contains: search, mode: "insensitive" } },
          ],
        },
      ],
    },
  };
}
