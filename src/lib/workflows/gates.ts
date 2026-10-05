import type { WorkflowEvidenceType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordTaskEvent } from "@/lib/tasks/events";
import { updateTask } from "@/lib/tasks/update";
import { checkEvidence, readChecklist } from "./evidence";

/**
 * A record gate completes itself.
 *
 * "Verify deposit received", "Confirm permit issued", "Confirm final
 * payment" and their case-side cousins exist to hold the workflow until a
 * fact is on record somewhere else in the CRM. Once the office has recorded
 * the deposit, asking someone to go and tick the step is the busywork the
 * streamlined workflow is meant to remove — so the writer that records the
 * fact calls this, and any ACTIVE gate whose record is now there (and whose
 * checklist has nothing left to tick) is completed on the spot.
 *
 * Only steps that are already active: a gate still waiting on its
 * predecessors stays in its place in the order. Never an inspection step —
 * recording the result on the step is what completes it. Best-effort and
 * never throws: the payment or the permit was saved whatever happens here.
 */

/**
 * Evidence that completes its step once it is on record. Not
 * INSPECTION_RESULT (recorded on the step itself), and not LINKED_JOB: the
 * linked job finishing makes "Corrective work complete" completable, but a
 * person confirms it — construction being done is a judgement the case
 * manager signs, not a flag.
 */
export const SELF_COMPLETING_GATES: ReadonlySet<WorkflowEvidenceType> = new Set<WorkflowEvidenceType>([
  "PERMIT_NUMBER",
  "PAYMENT_STATUS",
  "AGENCY_CONFIRMATION",
  "HEARING_RESULT",
  "FINE_STATUS",
  "VIOLATION_ITEMS",
  "LINKED_JOB_PERMIT",
]);

/**
 * Checklist lines that restate a fact the CRM already holds. They tick
 * themselves, so nobody is asked to confirm by hand what the job record
 * already says. Matched on the line's wording, so a template that rewords a
 * line simply goes back to a manual tick. Pure.
 */
export type HeldFacts = {
  projectManagerSet: boolean;
  /** A superintendent is named on the workflow team. */
  superintendentSet: boolean;
  targetStartSet: boolean;
  /** A permit is on the job with its application date. */
  permitOnFile: boolean;
  /** Every permit has passed final, or the job needs no permit. */
  permitsClosed: boolean;
  /** A crew is assigned to the job with an install date. */
  crewInstallSet: boolean;
};

const FACT_LINES: { test: RegExp; holds: (f: HeldFacts) => boolean }[] = [
  { test: /^Project manager set on the job/i, holds: (f) => f.projectManagerSet },
  { test: /^Superintendent \/ field lead set on the Workflow team/i, holds: (f) => f.superintendentSet },
  { test: /^Target start date set on the job/i, holds: (f) => f.targetStartSet },
  { test: /^Permit added on the Permits tab/i, holds: (f) => f.permitOnFile },
  { test: /^Permit closed on the Permits tab/i, holds: (f) => f.permitsClosed },
  { test: /^Crew and install date set/i, holds: (f) => f.crewInstallSet },
  // Completing "Close the job" moves the stage itself (stage-sync.ts), so there is nothing left to confirm.
  { test: /^Job moved to the Closed stage/i, holds: () => true },
];

/** Keys of the unticked lines whose fact is now true. */
export function linesToTick(checklist: { key: string; label: string; done: boolean }[], facts: HeldFacts): string[] {
  return checklist.filter((c) => !c.done && FACT_LINES.some((l) => l.test.test(c.label) && l.holds(facts))).map((c) => c.key);
}

/** Tick the held-fact lines on a job's active steps. Best-effort; returns how many lines were ticked. */
export async function tickHeldFacts(jobId: string, actorUserId: string): Promise<number> {
  let ticked = 0;
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        projectManagerId: true,
        targetStartDate: true,
        permits: { select: { status: true, submittedDate: true } },
        crewAssignments: { where: { installDate: { not: null } }, select: { id: true }, take: 1 },
        workflow: { select: { id: true, status: true, permitStatus: true, team: { select: { role: true } } } },
      },
    });
    if (!job?.workflow || job.workflow.status !== "ACTIVE") return 0;
    const facts: HeldFacts = {
      projectManagerSet: job.projectManagerId !== null,
      superintendentSet: job.workflow.team.some((t) => t.role === "SUPERINTENDENT"),
      targetStartSet: job.targetStartDate !== null,
      permitOnFile: job.permits.some((p) => p.submittedDate !== null),
      permitsClosed: job.workflow.permitStatus === "NOT_REQUIRED" || (job.permits.length > 0 && job.permits.every((p) => p.status === "FINAL")),
      crewInstallSet: job.crewAssignments.length > 0,
    };
    const steps = await prisma.task.findMany({
      where: { workflowInstanceId: job.workflow.id, workflowTaskKey: { not: null }, status: { in: ["PENDING", "IN_PROGRESS"] }, activatedAt: { not: null } },
      select: { id: true, checklist: true },
    });
    for (const s of steps) {
      const keys = linesToTick(readChecklist(s.checklist), facts);
      if (keys.length === 0) continue;
      await updateTask({ id: s.id, input: { checklist: keys.map((key) => ({ key, done: true })) }, actorUserId, notify: "none" });
      ticked += keys.length;
    }
  } catch (err) {
    logger.exception(err, { where: "workflows.tickHeldFacts", jobId });
  }
  return ticked;
}

const NOTE = "completed automatically — the record this step waits on is now on file";

export async function completeSatisfiedGates(instanceId: string, actorUserId: string): Promise<string[]> {
  const completed: string[] = [];
  try {
    // Completing one gate may wake the next; three rounds is deeper than any chain of gates in the templates.
    for (let round = 0; round < 3; round += 1) {
      const gates = await prisma.task.findMany({
        where: {
          workflowInstanceId: instanceId,
          workflowTaskKey: { not: null },
          status: { in: ["PENDING", "IN_PROGRESS"] },
          activatedAt: { not: null },
          requiredEvidence: { in: Array.from(SELF_COMPLETING_GATES) },
          // Closing a case is a person's decision even when the agency's confirmation is on file.
          NOT: { workflowTaskKey: { endsWith: ":close_case" } },
        },
        select: { id: true, jobId: true, violationCaseId: true, workflowInstanceId: true, requiredEvidence: true, requiredEvidenceParam: true, checklist: true, inspectionResult: true },
      });
      let progressed = false;
      for (const g of gates) {
        if (completed.includes(g.id)) continue;
        if (readChecklist(g.checklist).some((c) => !c.done)) continue;
        if (!(await checkEvidence(g)).ok) continue;
        await updateTask({ id: g.id, input: { status: "COMPLETED" }, actorUserId, notify: "none" });
        await recordTaskEvent({ taskId: g.id, actorUserId, type: "AUTO_CLOSED", toValue: "COMPLETED", body: NOTE });
        completed.push(g.id);
        progressed = true;
      }
      if (!progressed) break;
    }
  } catch (err) {
    logger.exception(err, { where: "workflows.completeSatisfiedGates", instanceId });
  }
  return completed;
}

/** After something was recorded on a job: its own gates, and those of any violation case the job is the corrective job for. */
export async function settleJobGates(jobId: string, actorUserId: string): Promise<number> {
  // Lines first: a record gate with a checklist waits for its lines.
  await tickHeldFacts(jobId, actorUserId);
  try {
    const instances = await prisma.jobWorkflowInstance.findMany({
      where: { status: "ACTIVE", OR: [{ jobId }, { violationCase: { jobId } }] },
      select: { id: true },
    });
    let n = 0;
    for (const i of instances) n += (await completeSatisfiedGates(i.id, actorUserId)).length;
    return n;
  } catch (err) {
    logger.exception(err, { where: "workflows.settleJobGates", jobId });
    return 0;
  }
}

/** After something was recorded on a violation case. */
export async function settleCaseGates(caseId: string, actorUserId: string): Promise<number> {
  try {
    const inst = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: caseId }, select: { id: true, status: true } });
    if (!inst || inst.status !== "ACTIVE") return 0;
    return (await completeSatisfiedGates(inst.id, actorUserId)).length;
  } catch (err) {
    logger.exception(err, { where: "workflows.settleCaseGates", caseId });
    return 0;
  }
}
