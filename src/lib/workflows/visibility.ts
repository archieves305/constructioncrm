import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { seesAllTasks, type VisibilityScope } from "@/lib/tasks/access";
import type { JobScope } from "./access";

/**
 * Relationships that widen an own-only role's view: a sales rep who is a
 * job's PM, a crew lead field-assigned to it, anyone holding a workflow team
 * slot (on a job or a violation case), and the case manager of a violation
 * case. Computed per request; the result is a plain id list the pure
 * `taskVisibilityFilter` can fold into its `where`.
 */
export async function visibilityScopeFor(user: { id: string; role: RoleName }): Promise<VisibilityScope | undefined> {
  if (seesAllTasks(user.role)) return undefined;
  const [pm, slots, field, managed] = await Promise.all([
    prisma.job.findMany({ where: { projectManagerId: user.id }, select: { id: true } }),
    prisma.jobWorkflowTeamMember.findMany({ where: { userId: user.id }, select: { instance: { select: { jobId: true, violationCaseId: true } } } }),
    prisma.jobFieldAssignment.findMany({ where: { userId: user.id }, select: { jobId: true } }),
    prisma.codeViolationCase.findMany({ where: { caseManagerId: user.id }, select: { id: true } }),
  ]);
  const jobIds = new Set<string>([
    ...pm.map((j) => j.id),
    ...slots.flatMap((s) => (s.instance.jobId ? [s.instance.jobId] : [])),
    ...field.map((f) => f.jobId),
  ]);
  const violationCaseIds = new Set<string>([
    ...managed.map((c) => c.id),
    ...slots.flatMap((s) => (s.instance.violationCaseId ? [s.instance.violationCaseId] : [])),
  ]);
  return { jobIds: Array.from(jobIds), violationCaseIds: Array.from(violationCaseIds) };
}

/**
 * Who is on a violation case, in the same shape the workflow permission
 * checks take for a job: the case manager sits in the PM position, team
 * slots are team slots, and there are no field assignments.
 */
export async function caseScopeFor(caseId: string): Promise<JobScope | null> {
  const c = await prisma.codeViolationCase.findUnique({
    where: { id: caseId },
    select: { caseManagerId: true, workflow: { select: { team: { select: { userId: true } } } } },
  });
  if (!c) return null;
  return { projectManagerId: c.caseManagerId, teamUserIds: c.workflow?.team.map((t) => t.userId) ?? [], fieldUserIds: [] };
}

/** The scope for whichever subject a task belongs to (job or violation case), or null for neither. */
export async function subjectScopeForTask(task: { jobId: string | null; violationCaseId: string | null }): Promise<JobScope | null> {
  if (task.jobId) return jobScopeFor(task.jobId);
  if (task.violationCaseId) return caseScopeFor(task.violationCaseId);
  return null;
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
