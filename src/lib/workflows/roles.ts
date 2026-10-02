import type { Prisma, WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { updateTask } from "@/lib/tasks/update";
import { logger } from "@/lib/logger";
import { loadSubject, loadSubjectForInstance, type WorkflowSubject } from "./subject";

/**
 * Functional role → person, per subject.
 *
 * Order of resolution: an explicit team slot on the workflow, then the
 * subject's own fields for the roles it already has (a job's project manager
 * and sales rep; a violation case's case manager, and its linked job's PM),
 * then the company-wide default, then nobody — an unassigned task with a
 * warning is more honest than guessing.
 */

export { WORKFLOW_ROLES, WORKFLOW_ROLE_LABEL } from "./role-labels";
import { WORKFLOW_ROLES } from "./role-labels";

export type RoleContext = {
  team: Partial<Record<WorkflowRole, string>>;
  projectManagerId: string | null;
  salesRepId: string | null;
  caseManagerId: string | null;
  defaults: Partial<Record<WorkflowRole, string>>;
};

export function resolveAssignee(role: WorkflowRole, ctx: RoleContext): string | null {
  const slot = ctx.team[role];
  if (slot) return slot;
  if (role === "PROJECT_MANAGER" && ctx.projectManagerId) return ctx.projectManagerId;
  if (role === "SALES_REP" && ctx.salesRepId) return ctx.salesRepId;
  if (role === "CASE_MANAGER" && ctx.caseManagerId) return ctx.caseManagerId;
  return ctx.defaults[role] ?? null;
}

/** Roles used by the plan that resolve to nobody, in a stable order. */
export function unassignedRoles(roles: Iterable<WorkflowRole>, ctx: RoleContext): WorkflowRole[] {
  const used = new Set(roles);
  return WORKFLOW_ROLES.filter((r) => used.has(r) && resolveAssignee(r, ctx) === null);
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Build the resolution context. Pass the subject when you already hold it;
 * `instanceId` alone loads the owning subject; `jobId` alone is the older
 * job-only form and still works.
 */
export async function loadRoleContext(
  db: Db,
  input: {
    subject?: WorkflowSubject | null;
    instanceId?: string | null;
    jobId?: string;
    teamOverride?: Partial<Record<WorkflowRole, string | null>>;
  },
): Promise<RoleContext> {
  const subjectPromise: Promise<WorkflowSubject | null> = input.subject
    ? Promise.resolve(input.subject)
    : input.instanceId
      ? loadSubjectForInstance(db, input.instanceId)
      : input.jobId
        ? loadSubject(db, { kind: "job", jobId: input.jobId })
        : Promise.resolve(null);
  const [subject, defaults, slots] = await Promise.all([
    subjectPromise,
    db.workflowRoleDefault.findMany({ select: { role: true, userId: true } }),
    input.instanceId
      ? db.jobWorkflowTeamMember.findMany({ where: { instanceId: input.instanceId }, select: { role: true, userId: true } })
      : Promise.resolve([]),
  ]);
  const team: Partial<Record<WorkflowRole, string>> = {};
  for (const s of slots) team[s.role] = s.userId;
  for (const [role, userId] of Object.entries(input.teamOverride ?? {}) as [WorkflowRole, string | null][]) {
    if (userId) team[role] = userId;
    else delete team[role];
  }
  const def: Partial<Record<WorkflowRole, string>> = {};
  for (const d of defaults) def[d.role] = d.userId;
  return {
    team,
    projectManagerId: subject?.people.projectManagerId ?? null,
    salesRepId: subject?.people.salesRepId ?? null,
    caseManagerId: subject?.people.caseManagerId ?? null,
    defaults: def,
  };
}

/**
 * Who fills a role on a job, whether or not the job has a workflow: the
 * job's team slot, then the job's own PM / sales rep, then the company
 * default (Admin → Workflow Roles). Null when nobody does — callers ask for a
 * person rather than guess.
 */
export async function userForJobRole(jobId: string, role: WorkflowRole, db: Db = prisma): Promise<string | null> {
  const instance = await db.jobWorkflowInstance.findUnique({ where: { jobId }, select: { id: true } });
  if (instance) return resolveAssignee(role, await loadRoleContext(db, { instanceId: instance.id }));
  // No workflow, so no team: the job's own fields and the company defaults.
  const [job, def] = await Promise.all([
    db.job.findUnique({ where: { id: jobId }, select: { projectManagerId: true, salesRepId: true } }),
    db.workflowRoleDefault.findUnique({ where: { role }, select: { userId: true } }),
  ]);
  if (role === "PROJECT_MANAGER" && job?.projectManagerId) return job.projectManagerId;
  if (role === "SALES_REP" && job?.salesRepId) return job.salesRepId;
  return def?.userId ?? null;
}

/**
 * After a team, PM or case-manager change: give every open, unassigned
 * workflow task whose role now resolves to someone an owner. Through
 * `updateTask`, so the timeline shows who was put on it.
 *
 * Only steps that are already active notify — a step still waiting on its
 * predecessors tells its owner when it becomes Ready, like any other step.
 * The active ones share one batch key so a PM set after apply gets "12
 * steps assigned to you on 12 Elm St", not twelve mails.
 */
export async function reassignUnresolved(instanceId: string, actorUserId: string): Promise<number> {
  const ctx = await loadRoleContext(prisma, { instanceId });
  const open = await prisma.task.findMany({
    where: {
      workflowInstanceId: instanceId,
      assignedUserId: null,
      workflowRole: { not: null },
      status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
    },
    select: { id: true, workflowRole: true, activatedAt: true },
  });
  const resolved = open
    .map((t) => ({ ...t, userId: resolveAssignee(t.workflowRole!, ctx) }))
    .filter((t): t is typeof t & { userId: string } => Boolean(t.userId));
  const activeCount = resolved.filter((t) => t.activatedAt).length;
  const batch = { key: `wf-reassign:${instanceId}:${Date.now()}`, size: activeCount };
  let n = 0;
  for (const t of resolved) {
    try {
      await updateTask({
        id: t.id,
        input: { assignedUserId: t.userId },
        actorUserId,
        notify: t.activatedAt ? "after" : "none",
        notifyBatch: batch,
      });
      n++;
    } catch (err) {
      logger.exception(err, { where: "workflows.reassignUnresolved", taskId: t.id });
    }
  }
  return n;
}
