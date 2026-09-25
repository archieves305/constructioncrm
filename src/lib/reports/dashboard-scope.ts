import type { Prisma } from "@/generated/prisma/client";
import { leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import type { ListScope } from "@/lib/lists/scope";

/** The lead `where` every dashboard count shares: optional date window, plus Mine. */
export function dashboardLeadWhere(input: { dateFilter?: Prisma.DateTimeFilter | null; scope: ListScope; userId: string }): Prisma.LeadWhereInput | undefined {
  const and: Prisma.LeadWhereInput[] = [];
  if (input.dateFilter && Object.keys(input.dateFilter).length > 0) and.push({ createdAt: input.dateFilter });
  if (input.scope === "mine") and.push(leadsInvolvingUserWhere(input.userId));
  if (and.length === 0) return undefined;
  if (and.length === 1) return and[0];
  return { AND: and };
}

/** Overdue tasks on the dashboard: mine = assigned to me, which is what the sidebar badge and /tasks?overdue=1 mean. */
export function dashboardTaskWhere(input: { scope: ListScope; userId: string }): Prisma.TaskWhereInput {
  return input.scope === "mine" ? { assignedUserId: input.userId } : {};
}
