import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordTaskEvent } from "@/lib/tasks/events";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { onTaskTransition } from "@/lib/tasks/transitions";

/**
 * One source of truth for "the job's workflow already raises this".
 *
 * Before the workflow existed, stage changes, the won-lead handler and the
 * permit follow-up rules each raised their own tasks. On a job with a
 * workflow those are the same work a second time, so they stand down:
 *
 *  - a stage task template marked `skipWhenWorkflow` is not spawned;
 *  - the two permit rule tasks below are not created;
 *  - applying a workflow offers to close the open tasks it replaces.
 *
 * Customer-care tasks (welcome call, review request) and the chasers that
 * close themselves (payment on an invoice, a sent change order, a returned
 * daily log) are not the workflow's and keep running.
 */

/** Follow-up rules whose TASK duplicates a workflow step; their emails and texts still send. */
export const WORKFLOW_COVERED_RULE_TASKS: ReadonlySet<string> = new Set([
  "Permit Issued: Schedule Install Task",
  "Permit Final: Office Close-Out Task",
]);

export async function jobHasActiveWorkflow(jobId: string | null | undefined): Promise<boolean> {
  if (!jobId) return false;
  const inst = await prisma.jobWorkflowInstance.findUnique({ where: { jobId }, select: { status: true } });
  return inst?.status === "ACTIVE";
}

/** True when a follow-up rule's task would duplicate a step on the permit's job. */
export async function workflowCoversRuleTask(ruleName: string, jobId: string | null | undefined): Promise<boolean> {
  return WORKFLOW_COVERED_RULE_TASKS.has(ruleName) && (await jobHasActiveWorkflow(jobId));
}

export type SupersededTask = { taskId: string; title: string };

/**
 * Open tasks on the job that the workflow's own steps replace: the deposit
 * task raised when the lead was won, and stage tasks whose template is
 * marked "skip on jobs that have a workflow". Never a task a person wrote.
 */
export async function findSupersededTasks(jobId: string): Promise<SupersededTask[]> {
  const skipped = await prisma.jobTaskTemplate.findMany({ where: { skipWhenWorkflow: true }, select: { title: true } });
  const titles = Array.from(new Set(skipped.map((t) => t.title)));
  const rows = await prisma.task.findMany({
    where: {
      jobId,
      status: { in: [...OPEN_TASK_STATUSES] },
      workflowInstanceId: null,
      // A task's source lives on its CREATED event, not on the row.
      OR: [
        { events: { some: { type: "CREATED", toValue: "job_deposit" } } },
        ...(titles.length > 0 ? [{ title: { in: titles }, events: { some: { type: "CREATED" as const, toValue: "stage_template" } } }] : []),
      ],
    },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ taskId: r.id, title: r.title }));
}

/** Cancel them, with the reason on each task's timeline. Never throws: the apply already succeeded. */
export async function closeSupersededTasks(jobId: string, actorUserId: string): Promise<number> {
  try {
    const tasks = await findSupersededTasks(jobId);
    if (tasks.length === 0) return 0;
    const ids = tasks.map((t) => t.taskId);
    const before = await prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED", blockedReason: null } });
    for (const t of before) {
      await recordTaskEvent({ taskId: t.id, actorUserId, type: "AUTO_CLOSED", toValue: "CANCELLED", body: "The job's workflow now carries this step" });
      await onTaskTransition({ taskId: t.id, from: t.status, to: "CANCELLED", actorUserId });
    }
    return before.length;
  } catch (err) {
    logger.exception(err, { where: "workflows.closeSupersededTasks", jobId });
    return 0;
  }
}
