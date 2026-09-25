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
 *
 * Two code-violation bridges hang off the same hook, both best-effort and
 * loaded lazily so the task module never imports the case services at
 * module load: a corrective job's workflow completing stamps its cases,
 * and a case's "Close case" step completing closes the case.
 */
export async function onTaskTransition(input: {
  taskId: string;
  from: TaskStatus;
  to: TaskStatus;
  actorUserId: string | null;
  actorRole?: import("@/generated/prisma/client").RoleName | null;
}): Promise<void> {
  if (input.from === input.to) return;
  try {
    if (isSatisfied(input.to) && !isSatisfied(input.from)) {
      await onTaskClosed({ taskId: input.taskId, actorUserId: input.actorUserId });
      await afterClose(input);
    } else if (isSatisfied(input.from) && !isSatisfied(input.to)) {
      // Reopened: the workflow may no longer be complete.
      const t = await prisma.task.findUnique({ where: { id: input.taskId }, select: { workflowInstanceId: true } });
      if (t?.workflowInstanceId) await maybeCompleteInstance(t.workflowInstanceId);
    }
  } catch (err) {
    logger.exception(err, { where: "onTaskTransition", taskId: input.taskId, to: input.to });
  }
}

async function afterClose(input: { taskId: string; to: TaskStatus; actorUserId: string | null; actorRole?: import("@/generated/prisma/client").RoleName | null }) {
  const t = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { workflowTaskKey: true, violationCaseId: true, workflowInstance: { select: { id: true, status: true, jobId: true } } },
  });
  if (!t?.workflowInstance) return;
  // A corrective job's workflow just completed → its violation cases may proceed.
  if (t.workflowInstance.status === "COMPLETED" && t.workflowInstance.jobId) {
    const { onJobCompleted } = await import("@/lib/violations/job-sync");
    await onJobCompleted(t.workflowInstance.jobId, input.actorUserId, "workflow");
  }
  // The case's closing step was completed (with the agency confirmation on
  // file, or by an ADMIN/MANAGER overriding the evidence) → close the case.
  if (input.to === "COMPLETED" && t.violationCaseId && t.workflowTaskKey?.endsWith(":close_case") && input.actorUserId) {
    const { closeCase } = await import("@/lib/violations/close");
    const { canOverrideClosure } = await import("@/lib/violations/access");
    const { ViolationError } = await import("@/lib/violations/errors");
    const role = input.actorRole ?? null;
    try {
      await closeCase({
        caseId: t.violationCaseId,
        actor: { id: input.actorUserId, role: role ?? "OFFICE_STAFF" },
        reason: "Close-case step completed",
        // Only an admin/manager may close past the remaining blockers; anyone
        // else's completion closes the case only when every blocker is clear.
        overrideReason: role && canOverrideClosure(role) ? "Closed through the workflow's Close-case step past the remaining blockers" : null,
        source: "workflow",
      });
    } catch (err) {
      // 409 = already closed; 400 = blockers remain and the actor may not override — the case stays open, the step is done, and the log says so.
      if (err instanceof ViolationError && (err.status === 409 || err.status === 400)) {
        logger.warn("close_case step completed but the case did not close", { taskId: input.taskId, caseId: t.violationCaseId, message: err.message });
        return;
      }
      throw err;
    }
  }
}
