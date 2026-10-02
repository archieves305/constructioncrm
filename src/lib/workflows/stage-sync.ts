import type { TaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { CORE_MODULE_KEY, fullKey } from "./keys";

/**
 * The job stage follows the workflow.
 *
 * Stage and workflow used to be two trackers kept in step by hand, and they
 * drifted: jobs sat in "Deposit Needed" while their workflow moved on, and the
 * board, Collections and the "next action" all read the stage. Now a Core
 * milestone moves the stage forward when it is reached.
 *
 * Forward only: the stage never moves back, and a stage someone set further
 * ahead by hand is left alone. A job with no workflow is untouched — its stage
 * is still moved by hand.
 */
export type StageStep = { key: string | null; status: TaskStatus; activatedAt: Date | null };

const core = (short: string) => fullKey(CORE_MODULE_KEY, short);

/**
 * The stage the workflow has earned, or null when no milestone is reached yet.
 * Checked from the end of the job backwards, so the furthest milestone wins.
 * "Done" is COMPLETED only: a skipped or retired step proves nothing.
 */
export function stageNameForWorkflow(steps: StageStep[]): string | null {
  const byKey = new Map<string, StageStep>();
  for (const s of steps) if (s.key) byKey.set(s.key, s);
  const done = (short: string) => byKey.get(core(short))?.status === "COMPLETED";
  // Active or finished: its predecessors are behind it.
  const reached = (short: string) => {
    const s = byKey.get(core(short));
    return Boolean(s && s.status !== "CANCELLED" && (s.activatedAt !== null || s.status === "COMPLETED"));
  };

  if (done("close_job")) return "Closed";
  if (done("submit_final_invoice") || reached("confirm_final_payment")) return "Final Payment Due";
  if (done("complete_punch_list") && reached("obtain_final_inspection") && !done("obtain_final_inspection")) return "Final Inspection";
  if (reached("complete_punch_list")) return "Punch List";
  if (done("confirm_production_start")) return "In Progress";
  if (done("confirm_permit_issued")) return "Permit Approved";
  if (done("submit_permit_application")) return "Permit Submitted";
  if (done("precon_plan")) return "Scope Finalized";
  if (done("verify_deposit")) return "Financing Cleared";
  return null;
}

/**
 * Move the job to the stage its workflow has reached, if that is ahead of
 * where it stands. Best-effort and never throws: the step was completed
 * whatever happens here. Returns the stage it moved to, or null.
 */
export async function syncJobStageFromWorkflow(jobId: string, actorUserId: string | null): Promise<string | null> {
  if (!actorUserId) return null;
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { currentStage: { select: { stageOrder: true } }, workflow: { select: { id: true } } },
    });
    if (!job?.workflow) return null;

    const steps = await prisma.task.findMany({
      where: { workflowInstanceId: job.workflow.id, workflowTaskKey: { startsWith: `${CORE_MODULE_KEY}:` } },
      select: { workflowTaskKey: true, status: true, activatedAt: true },
    });
    const name = stageNameForWorkflow(steps.map((s) => ({ key: s.workflowTaskKey, status: s.status, activatedAt: s.activatedAt })));
    if (!name) return null;

    const target = await prisma.jobStage.findFirst({ where: { name }, select: { id: true, stageOrder: true } });
    if (!target || target.stageOrder <= job.currentStage.stageOrder) return null;

    // Lazy: services/jobs imports the task and workflow modules.
    const { changeJobStage } = await import("@/lib/services/jobs");
    await changeJobStage(jobId, target.id, actorUserId, "Moved by the workflow");
    return name;
  } catch (err) {
    logger.exception(err, { where: "workflows.syncJobStageFromWorkflow", jobId });
    return null;
  }
}
