import type { Prisma, WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { updateTask } from "@/lib/tasks/update";
import { logger } from "@/lib/logger";

/**
 * Functional role → person, per job.
 *
 * Order of resolution: an explicit team slot on the job's workflow, then the
 * job's own fields for the two roles it already has (project manager, sales
 * rep), then the company-wide default, then nobody — an unassigned task with
 * a warning is more honest than guessing.
 */

export { WORKFLOW_ROLES, WORKFLOW_ROLE_LABEL } from "./role-labels";
import { WORKFLOW_ROLES } from "./role-labels";

export type RoleContext = {
  team: Partial<Record<WorkflowRole, string>>;
  projectManagerId: string | null;
  salesRepId: string | null;
  defaults: Partial<Record<WorkflowRole, string>>;
};

export function resolveAssignee(role: WorkflowRole, ctx: RoleContext): string | null {
  const slot = ctx.team[role];
  if (slot) return slot;
  if (role === "PROJECT_MANAGER" && ctx.projectManagerId) return ctx.projectManagerId;
  if (role === "SALES_REP" && ctx.salesRepId) return ctx.salesRepId;
  return ctx.defaults[role] ?? null;
}

/** Roles used by the plan that resolve to nobody, in a stable order. */
export function unassignedRoles(roles: Iterable<WorkflowRole>, ctx: RoleContext): WorkflowRole[] {
  const used = new Set(roles);
  return WORKFLOW_ROLES.filter((r) => used.has(r) && resolveAssignee(r, ctx) === null);
}

type Db = Prisma.TransactionClient | typeof prisma;

export async function loadRoleContext(
  db: Db,
  input: { jobId: string; instanceId?: string | null; teamOverride?: Partial<Record<WorkflowRole, string | null>> },
): Promise<RoleContext> {
  const [job, defaults, slots] = await Promise.all([
    db.job.findUnique({ where: { id: input.jobId }, select: { projectManagerId: true, salesRepId: true } }),
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
    projectManagerId: job?.projectManagerId ?? null,
    salesRepId: job?.salesRepId ?? null,
    defaults: def,
  };
}

/**
 * After a team or PM change: give every open, unassigned workflow task whose
 * role now resolves to someone an owner. Through `updateTask`, so the
 * assignee gets the mail and the timeline shows who was put on it.
 */
export async function reassignUnresolved(instanceId: string, actorUserId: string): Promise<number> {
  const inst = await prisma.jobWorkflowInstance.findUnique({ where: { id: instanceId }, select: { jobId: true } });
  if (!inst) return 0;
  const ctx = await loadRoleContext(prisma, { jobId: inst.jobId, instanceId });
  const open = await prisma.task.findMany({
    where: {
      workflowInstanceId: instanceId,
      assignedUserId: null,
      workflowRole: { not: null },
      status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
    },
    select: { id: true, workflowRole: true },
  });
  let n = 0;
  for (const t of open) {
    const userId = resolveAssignee(t.workflowRole!, ctx);
    if (!userId) continue;
    try {
      await updateTask({ id: t.id, input: { assignedUserId: userId }, actorUserId, notify: "after" });
      n++;
    } catch (err) {
      logger.exception(err, { where: "workflows.reassignUnresolved", taskId: t.id });
    }
  }
  return n;
}
