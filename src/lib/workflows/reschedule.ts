import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { updateTask } from "@/lib/tasks/update";
import { loadScheduleContext } from "./activation";
import { recomputeAfterAnchorChange, type DateAnchor } from "./schedule";

/**
 * One of the subject's anchor dates moved (a job's target start, a case's
 * compliance deadline or hearing date): shift every open, unlocked step
 * anchored to it. Through `updateTask` with `dueLocked: false` so the
 * timeline records the move and the date stays the engine's to manage.
 * Reads the subject fresh, so the caller writes the new date first.
 */
export async function rescheduleAnchor(instanceId: string, anchor: DateAnchor, actorUserId: string): Promise<number> {
  const ctx = await loadScheduleContext(prisma, instanceId);
  if (!ctx) return 0;
  const tasks = await prisma.task.findMany({
    where: { workflowInstanceId: instanceId, workflowAnchor: anchor },
    select: { id: true, status: true, dueLocked: true, activatedAt: true, workflowAnchor: true, dueOffsetBusinessDays: true },
  });
  const moves = recomputeAfterAnchorChange(
    tasks.map((t) => ({ ...t, anchor: t.workflowAnchor ?? anchor, dueOffsetBusinessDays: t.dueOffsetBusinessDays ?? 0 })),
    ctx,
    anchor,
  );
  let n = 0;
  for (const m of moves) {
    try {
      await updateTask({ id: m.id, input: { dueAt: m.dueAt?.toISOString() ?? null, dueLocked: false }, actorUserId, notify: "none" });
      n++;
    } catch (err) {
      logger.exception(err, { where: "workflows.rescheduleAnchor", anchor, taskId: m.id });
    }
  }
  return n;
}

/** The job's target start date moved. */
export async function rescheduleTargetStart(jobId: string, actorUserId: string): Promise<number> {
  const inst = await prisma.jobWorkflowInstance.findUnique({ where: { jobId }, select: { id: true } });
  if (!inst) return 0;
  return rescheduleAnchor(inst.id, "TARGET_START", actorUserId);
}
