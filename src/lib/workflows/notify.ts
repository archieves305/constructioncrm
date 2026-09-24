import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { notifyTaskAssigned } from "@/lib/tasks/notify";
import { runAfterResponse } from "@/lib/tasks/defer";

/**
 * Tell assignees their workflow steps just became Ready.
 *
 * Reuses the assignment mail — "this is now your work" is exactly the
 * message — and is gated by WORKFLOW_READY_EMAILS_ENABLED (default off for
 * the first week, like escalations were) because the morning digest already
 * lists every ready step with a date.
 */
export function isReadyEmailEnabled(): boolean {
  return env.WORKFLOW_READY_EMAILS_ENABLED === "1";
}

export function notifyTasksReady(taskIds: string[], actorUserId: string | null): void {
  if (taskIds.length === 0 || !isReadyEmailEnabled()) return;
  runAfterResponse(
    async () => {
      for (const taskId of taskIds) {
        try {
          await notifyTaskAssigned({ taskId, actorUserId });
        } catch (err) {
          logger.exception(err, { where: "workflows.notifyTasksReady", taskId });
        }
      }
    },
    { where: "workflows.notifyTasksReady", count: taskIds.length },
  );
}
