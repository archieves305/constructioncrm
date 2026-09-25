import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordCaseEvent } from "./events";

/**
 * The one bridge from a corrective job back to its violation cases. When a
 * linked job's workflow completes (or the job reaches a closed stage), every
 * open case pointing at it gets `correctiveWorkCompletedAt` stamped, which
 * is the evidence the case's blocking "corrective work complete" step needs.
 * A person still completes that step; and construction completion never
 * touches agency compliance. Best-effort: never throws.
 */
export async function onJobCompleted(jobId: string, actorUserId: string | null, source: "workflow" | "stage"): Promise<string[]> {
  try {
    const cases = await prisma.codeViolationCase.findMany({
      where: { jobId, correctiveWorkCompletedAt: null, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, job: { select: { jobNumber: true } } },
    });
    if (cases.length === 0) return [];
    const now = new Date();
    await prisma.codeViolationCase.updateMany({ where: { id: { in: cases.map((c) => c.id) } }, data: { correctiveWorkCompletedAt: now } });
    for (const c of cases) {
      await recordCaseEvent(prisma, {
        caseId: c.id,
        actorUserId,
        type: "CORRECTIVE_WORK_COMPLETED",
        body: source === "workflow" ? `${c.job?.jobNumber ?? "Linked job"} workflow completed` : `${c.job?.jobNumber ?? "Linked job"} reached a closed stage`,
      });
    }
    return cases.map((c) => c.id);
  } catch (err) {
    logger.exception(err, { where: "violations.onJobCompleted", jobId });
    return [];
  }
}

/** A job linked after it already finished: stamp now. Returns whether it did. */
export async function syncCorrectiveWorkFromJob(caseId: string, actorUserId: string | null): Promise<boolean> {
  const c = await prisma.codeViolationCase.findUnique({
    where: { id: caseId },
    select: { correctiveWorkCompletedAt: true, job: { select: { id: true, jobNumber: true, currentStage: { select: { isClosed: true } }, workflow: { select: { status: true } } } } },
  });
  if (!c?.job || c.correctiveWorkCompletedAt) return false;
  const done = c.job.workflow?.status === "COMPLETED" || c.job.currentStage.isClosed;
  if (!done) return false;
  await prisma.codeViolationCase.update({ where: { id: caseId }, data: { correctiveWorkCompletedAt: new Date() } });
  await recordCaseEvent(prisma, { caseId, actorUserId, type: "CORRECTIVE_WORK_COMPLETED", body: `${c.job.jobNumber} was already complete when linked` });
  return true;
}
