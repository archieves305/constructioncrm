import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { canViewTask, seesAllTasks, type VisibilityScope } from "@/lib/tasks/access";
import { canViewAllCases, violationVisibilityFilter } from "@/lib/violations/access";
import { visibilityScopeFor } from "@/lib/workflows/visibility";

/**
 * A digest must never tell someone about a task, job, lead or case they can
 * no longer open. Rows are recorded at event time; by the window, an
 * assignment may have moved on. This re-checks at claim time with at most
 * five queries per recipient, however many rows they have.
 */

export type VisibleCheckRow = {
  id: string;
  taskId: string | null;
  jobId: string | null;
  leadId: string | null;
  violationCaseId: string | null;
};

export type VisibleSets = {
  all: boolean;
  taskIds: Set<string>;
  jobIds: Set<string>;
  leadIds: Set<string>;
  caseIds: Set<string>;
};

/** Pure: which rows survive, given what the person may see. */
export function splitVisible<T extends VisibleCheckRow>(rows: T[], sets: VisibleSets): { visible: T[]; suppressed: T[] } {
  if (sets.all) return { visible: rows, suppressed: [] };
  const visible: T[] = [];
  const suppressed: T[] = [];
  for (const r of rows) {
    const ok =
      (r.taskId ? sets.taskIds.has(r.taskId) : false) ||
      (!r.taskId && r.violationCaseId ? sets.caseIds.has(r.violationCaseId) : false) ||
      (!r.taskId && !r.violationCaseId && r.jobId ? sets.jobIds.has(r.jobId) : false) ||
      (!r.taskId && !r.violationCaseId && !r.jobId && r.leadId ? sets.leadIds.has(r.leadId) : false) ||
      (!r.taskId && !r.violationCaseId && !r.jobId && !r.leadId);
    (ok ? visible : suppressed).push(r);
  }
  return { visible, suppressed };
}

/** Resolve what this person may see for exactly these rows' subjects. */
export async function visibleSetsFor(user: { id: string; role: RoleName }, rows: VisibleCheckRow[]): Promise<VisibleSets> {
  if (seesAllTasks(user.role) && canViewAllCases(user.role)) {
    return { all: true, taskIds: new Set(), jobIds: new Set(), leadIds: new Set(), caseIds: new Set() };
  }
  const taskIds = Array.from(new Set(rows.flatMap((r) => (r.taskId ? [r.taskId] : []))));
  const caseIds = Array.from(new Set(rows.flatMap((r) => (!r.taskId && r.violationCaseId ? [r.violationCaseId] : []))));
  const jobIds = Array.from(new Set(rows.flatMap((r) => (!r.taskId && !r.violationCaseId && r.jobId ? [r.jobId] : []))));
  const leadIds = Array.from(new Set(rows.flatMap((r) => (!r.taskId && !r.violationCaseId && !r.jobId && r.leadId ? [r.leadId] : []))));

  const scope: VisibilityScope | undefined = await visibilityScopeFor(user);
  const [tasks, cases, jobs, leads] = await Promise.all([
    taskIds.length
      ? prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, assignedUserId: true, createdByUserId: true, jobId: true, violationCaseId: true } })
      : [],
    caseIds.length ? prisma.codeViolationCase.findMany({ where: { AND: [{ id: { in: caseIds } }, violationVisibilityFilter(user)] }, select: { id: true } }) : [],
    jobIds.length ? prisma.job.findMany({ where: { AND: [{ id: { in: jobIds } }, jobsInvolvingUserWhere(user.id)] }, select: { id: true } }) : [],
    leadIds.length ? prisma.lead.findMany({ where: { AND: [{ id: { in: leadIds } }, leadsInvolvingUserWhere(user.id)] }, select: { id: true } }) : [],
  ]);
  return {
    all: false,
    taskIds: new Set(tasks.filter((t) => canViewTask(user, t, scope)).map((t) => t.id)),
    caseIds: new Set(cases.map((c) => c.id)),
    jobIds: new Set(jobs.map((j) => j.id)),
    leadIds: new Set(leads.map((l) => l.id)),
  };
}

export async function filterVisibleRows<T extends VisibleCheckRow>(user: { id: string; role: RoleName }, rows: T[]): Promise<{ visible: T[]; suppressed: T[] }> {
  if (rows.length === 0) return { visible: [], suppressed: [] };
  return splitVisible(rows, await visibleSetsFor(user, rows));
}
