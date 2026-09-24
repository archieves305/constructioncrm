import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { updateTask } from "@/lib/tasks/update";
import { loadScheduleContext } from "./activation";
import { recomputeAfterTargetStartChange } from "./schedule";

/**
 * The job's target start date moved: shift every open, unlocked,
 * TARGET_START-anchored step with it. Through `updateTask` with
 * `dueLocked: false` so the timeline records the move and the date stays
 * the engine's to manage.
 */
export async function rescheduleTargetStart(jobId: string, actorUserId: string): Promise<number> {
  const inst = await prisma.jobWorkflowInstance.findUnique({ where: { jobId }, select: { id: true } });
  if (!inst) return 0;
  const ctx = await loadScheduleContext(prisma, inst.id);
  if (!ctx) return 0;
  const tasks = await prisma.task.findMany({
    where: { workflowInstanceId: inst.id, workflowAnchor: "TARGET_START" },
    select: { id: true, status: true, dueLocked: true, activatedAt: true, workflowAnchor: true, dueOffsetBusinessDays: true },
  });
  const moves = recomputeAfterTargetStartChange(
    tasks.map((t) => ({ ...t, anchor: t.workflowAnchor ?? "TARGET_START", dueOffsetBusinessDays: t.dueOffsetBusinessDays ?? 0 })),
    ctx,
  );
  let n = 0;
  for (const m of moves) {
    try {
      await updateTask({ id: m.id, input: { dueAt: m.dueAt?.toISOString() ?? null, dueLocked: false }, actorUserId, notify: "none" });
      n++;
    } catch (err) {
      logger.exception(err, { where: "workflows.rescheduleTargetStart", taskId: m.id });
    }
  }
  return n;
}
