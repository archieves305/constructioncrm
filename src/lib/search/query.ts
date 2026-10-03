import type { Prisma, RoleName } from "@/generated/prisma/client";
import { buildJobListWhere } from "@/lib/jobs/query";
import { buildLeadListWhere } from "@/lib/leads/query";
import { prospectVisibilityWhere } from "@/lib/prospects/access";
import { taskVisibilityFilter, type VisibilityScope } from "@/lib/tasks/access";
import { taskSearchWhere } from "@/lib/tasks/query";
import { buildViolationListWhere, parseViolationListParams } from "@/lib/violations/query";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { canViewVendors } from "@/lib/vendors/access";

/**
 * The ⌘K search reuses the list builders, so a search hit is exactly a row
 * the same person would see on the list page: the sales-rep floor on jobs
 * and leads, the visibility filter on cases, the assignment rule on
 * prospects. Nothing here decides access on its own.
 */
export type SearchContext = { user: { id: string; role: RoleName }; now: Date; /** Own-only roles' widened task view (jobs they PM etc.); undefined for view-all roles. */ scope?: VisibilityScope };

export type SearchWheres = {
  jobs: Prisma.JobWhereInput;
  leads: Prisma.LeadWhereInput;
  cases: Prisma.CodeViolationCaseWhereInput;
  prospects: Prisma.ProspectWhereInput;
  /** Active, open tasks by title / description / job / customer, under the task visibility rule. */
  tasks: Prisma.TaskWhereInput;
  /** Vendors by name, trade, contact or a payee alias; null for roles that cannot open the directory. */
  vendors: Prisma.VendorWhereInput | null;
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
    tasks: { AND: [ACTIVE_OPEN_WHERE, taskSearchWhere(search), taskVisibilityFilter(ctx.user, ctx.scope)] },
    vendors: canViewVendors(ctx.user.role)
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { trade: { contains: search, mode: "insensitive" } },
            { contactName: { contains: search, mode: "insensitive" } },
            { aliases: { some: { pattern: { contains: search.toLowerCase() } } } },
          ],
        }
      : null,
  };
}
