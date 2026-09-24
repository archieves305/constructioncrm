import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { seesAllTasks, type VisibilityScope } from "@/lib/tasks/access";
import type { JobScope } from "./access";

/**
 * Job relationships that widen an own-only role's view: a sales rep who is
 * the job's PM, a crew lead field-assigned to it, anyone holding a workflow
 * team slot. Computed per request; the result is a plain id list the pure
 * `taskVisibilityFilter` can fold into its `where`.
 */
export async function visibilityScopeFor(user: { id: string; role: RoleName }): Promise<VisibilityScope | undefined> {
  if (seesAllTasks(user.role)) return undefined;
  const [pm, slots, field] = await Promise.all([
    prisma.job.findMany({ where: { projectManagerId: user.id }, select: { id: true } }),
    prisma.jobWorkflowTeamMember.findMany({ where: { userId: user.id }, select: { instance: { select: { jobId: true } } } }),
    prisma.jobFieldAssignment.findMany({ where: { userId: user.id }, select: { jobId: true } }),
  ]);
  const ids = new Set<string>([...pm.map((j) => j.id), ...slots.map((s) => s.instance.jobId), ...field.map((f) => f.jobId)]);
  return { jobIds: Array.from(ids) };
}

/** Who is on a job, for the workflow permission checks. */
export async function jobScopeFor(jobId: string): Promise<JobScope | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      projectManagerId: true,
      workflow: { select: { team: { select: { userId: true } } } },
      fieldAssignments: { select: { userId: true } },
    },
  });
  if (!job) return null;
  return {
    projectManagerId: job.projectManagerId,
    teamUserIds: job.workflow?.team.map((t) => t.userId) ?? [],
    fieldUserIds: job.fieldAssignments.map((f) => f.userId),
  };
}
