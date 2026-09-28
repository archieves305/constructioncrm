import { logger } from "@/lib/logger";
import { notifyTaskAssigned } from "@/lib/tasks/notify";
import { runAfterResponse } from "@/lib/tasks/defer";
import type { NotifyBatch } from "@/lib/notifications/notify";

/**
 * Tell assignees their workflow steps just became Ready.
 *
 * Every step in one engine run (an apply, a completion's activation sweep,
 * a reconcile) shares a batch key, so the digest says "5 steps became
 * ready on 12 Elm St" instead of listing five mails' worth of lines. There
 * is no per-step legacy mail: before v2 the morning digest covered Ready
 * steps, and with v2 delivering they arrive in the next digest window.
 */

export function notifyTasksReady(taskIds: string[], actorUserId: string | null, batchKey: string): void {
  if (taskIds.length === 0) return;
  const batch: NotifyBatch = { key: batchKey, size: taskIds.length };
  runAfterResponse(
    async () => {
      for (const taskId of taskIds) {
        try {
          await notifyTaskAssigned({ taskId, actorUserId, batch, readyStep: true });
        } catch (err) {
          logger.exception(err, { where: "workflows.notifyTasksReady", taskId });
        }
      }
    },
    { where: "workflows.notifyTasksReady", count: taskIds.length, batchKey },
  );
}
