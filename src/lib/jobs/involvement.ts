import type { Prisma } from "@/generated/prisma/client";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";

/**
 * The one definition of "a role on a job", as Prisma relation filters so it
 * composes into any Job `where` without id lists: sales rep, project
 * manager, a workflow team slot, a field assignment, a crew on the job (crew
 * members are Personnel; only those linked to a User count), a per-job
 * personnel scope, or an open workflow step assigned to them.
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
      // Owning an open workflow step on the job. A role filled from the
      // company defaults (Admin → Workflow Roles) has no team slot on the
      // job, so without this the accountant named there would be handed the
      // deposit and payment steps of every job and see none of them in
      // "My jobs". Retired and finished steps do not count.
      { tasks: { some: { assignedUserId: userId, workflowTaskKey: { not: null }, status: { in: [...OPEN_TASK_STATUSES] } } } },
    ],
  };
}

/** Assigned to me, or the customer of a job I have a role on. */
export function leadsInvolvingUserWhere(userId: string): Prisma.LeadWhereInput {
  return { OR: [{ assignedUserId: userId }, { jobs: { some: jobsInvolvingUserWhere(userId) } }] };
}
