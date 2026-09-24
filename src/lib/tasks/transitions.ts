import type { TaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { isSatisfied } from "@/lib/workflows/dependencies";
import { maybeCompleteInstance, onTaskClosed } from "@/lib/workflows/activation";

/**
 * The hook `updateTask` (and `closeAutoTask`) call after a status change.
 * Wrapped so a failure in the engine logs and never turns a successful
 * save into a 500 — the task IS done; what failed is waking up the next one,
 * which the Workflow tab's reconcile can repair.
 */
export async function onTaskTransition(input: {
  taskId: string;
  from: TaskStatus;
  to: TaskStatus;
  actorUserId: string | null;
}): Promise<void> {
  if (input.from === input.to) return;
  try {
    if (isSatisfied(input.to) && !isSatisfied(input.from)) {
      await onTaskClosed({ taskId: input.taskId, actorUserId: input.actorUserId });
    } else if (isSatisfied(input.from) && !isSatisfied(input.to)) {
      // Reopened: the workflow may no longer be complete.
      const t = await prisma.task.findUnique({ where: { id: input.taskId }, select: { workflowInstanceId: true } });
      if (t?.workflowInstanceId) await maybeCompleteInstance(t.workflowInstanceId);
    }
  } catch (err) {
    logger.exception(err, { where: "onTaskTransition", taskId: input.taskId, to: input.to });
  }
}
