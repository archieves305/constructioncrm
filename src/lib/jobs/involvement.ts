import type { Prisma } from "@/generated/prisma/client";

/**
 * The one definition of "a role on a job", as Prisma relation filters so it
 * composes into any Job `where` without id lists: sales rep, project
 * manager, a workflow team slot, a field assignment, a crew on the job (crew
 * members are Personnel; only those linked to a User count), or a per-job
 * personnel scope.
 *
 * `visibilityScopeFor` in src/lib/workflows/visibility.ts is the task-side
 * cousin (id lists for the pure task filter); it lacks the sales-rep and
 * crew paths. The workflow-health widget and the list routes use this one.
 */
export function jobsInvolvingUserWhere(userId: string): Prisma.JobWhereInput {
  return {
    OR: [
      { salesRepId: userId },
      { projectManagerId: userId },
      { workflow: { team: { some: { userId } } } },
      { fieldAssignments: { some: { userId } } },
      { crewAssignments: { some: { crew: { members: { some: { userId } } } } } },
      { laborContracts: { some: { crew: { members: { some: { userId } } } } } },
      { personnelScopes: { some: { personnel: { userId } } } },
    ],
  };
}

/** Assigned to me, or the customer of a job I have a role on. */
export function leadsInvolvingUserWhere(userId: string): Prisma.LeadWhereInput {
  return { OR: [{ assignedUserId: userId }, { jobs: { some: jobsInvolvingUserWhere(userId) } }] };
}
