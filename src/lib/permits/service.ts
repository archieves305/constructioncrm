import type { PermitInspectionType, PermitStatus, Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { createTask } from "@/lib/tasks/create";
import { settleJobGates } from "@/lib/workflows/gates";
import { InspectionError, recordInspectionResult } from "@/lib/workflows/inspections";
import { userForJobRole } from "@/lib/workflows/roles";
import { addBusinessDaysFrom, atDueHour } from "@/lib/workflows/schedule";
import { settleInspectionAlerts, settlePermitAlerts } from "./alert-run";
import { closePermitIfFinalPassed } from "./effects";
import { isInspectionResult, isInspectionType, isPermitStatus, isRecordedResult, matchInspectionStep, resultAppliesToStep, statusStamps, type RecordedResult, type StepCandidate } from "./rules";

/**
 * Writers for a permit and its inspections. The routes validate the session
 * and the job scope; everything a change implies — stamped dates, the
 * workflow's inspection step, a correction task, the gates that wait on the
 * permit — happens here, once.
 */

type Actor = { id: string; role: RoleName };

export class PermitError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "PermitError";
  }
}

const words = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** A date field from a request body: undefined = not sent, null = cleared. */
function readDate(v: unknown, field: string): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new PermitError(400, `${field} is not a date`);
  return d;
}

function readFee(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new PermitError(400, "permitFee must be an amount of zero or more");
  return n.toFixed(2);
}

const text = (v: unknown): string | null | undefined => (v === undefined ? undefined : v === null ? null : String(v).trim() || null);

// ─── Permit ─────────────────────────────────────────────────────────────────

export async function updatePermit(id: string, body: Record<string, unknown>, actor: Actor) {
  const previous = await prisma.jobPermit.findUnique({ where: { id }, select: { status: true, approvedDate: true, finalPassedDate: true, jobId: true } });
  if (!previous) throw new PermitError(404, "Permit not found");
  if (body.status !== undefined && !isPermitStatus(body.status)) throw new PermitError(400, "status is not a permit status");
  const status = body.status as PermitStatus | undefined;
  if (body.municipality !== undefined && !String(body.municipality ?? "").trim()) throw new PermitError(400, "The jurisdiction cannot be empty");

  const data: Prisma.JobPermitUncheckedUpdateInput = {
    status,
    municipality: body.municipality === undefined ? undefined : String(body.municipality).trim(),
    permitType: text(body.permitType),
    permitNumber: text(body.permitNumber),
    submittedDate: readDate(body.submittedDate, "submittedDate"),
    expectedApprovalDate: readDate(body.expectedApprovalDate, "expectedApprovalDate"),
    approvedDate: readDate(body.approvedDate, "approvedDate"),
    expirationDate: readDate(body.expirationDate, "expirationDate"),
    finalPassedDate: readDate(body.finalPassedDate, "finalPassedDate"),
    assignedUserId: body.assignedUserId === undefined ? undefined : (body.assignedUserId as string | null) || null,
    inspectorName: text(body.inspectorName),
    permitFee: readFee(body.permitFee),
    notes: text(body.notes),
  };
  const changed = status !== undefined && status !== previous.status;
  if (changed) {
    // Issued or final without a date typed: today is the date.
    const stamps = statusStamps(status, previous, new Date());
    if (data.approvedDate === undefined && stamps.approvedDate) data.approvedDate = stamps.approvedDate;
    if (data.finalPassedDate === undefined && stamps.finalPassedDate) data.finalPassedDate = stamps.finalPassedDate;
  }

  const permit = await prisma.jobPermit.update({
    where: { id },
    data,
    include: {
      job: { select: { id: true, jobNumber: true, leadId: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (changed) {
    await prisma.activityLog.create({
      data: {
        leadId: permit.job.leadId,
        activityType: "PERMIT_ADDED",
        title: `Permit status → ${status}`,
        description: typeof body.notes === "string" && body.notes ? body.notes : undefined,
        createdByUserId: actor.id,
      },
    });
    await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: id, action: "status_change", before: { status: previous.status }, after: { status } });
  }
  // Issued, denied, a new submission or expiration date: the follow-ups raised on the old facts close.
  await settlePermitAlerts(permit.id, actor.id);
  // A permit number, an issue date or a final on file completes the step that waits on it.
  await settleJobGates(permit.jobId, actor.id);
  return permit;
}

// ─── Inspections ────────────────────────────────────────────────────────────

/** Which workflow step a result belongs to, as the request body says it. */
function stepChoice(body: Record<string, unknown>): { taskId: string | null | undefined; completesStep: boolean } {
  return { taskId: body.taskId === undefined ? undefined : body.taskId === null ? null : String(body.taskId), completesStep: body.completesStep === true };
}

export async function createPermitInspection(permitId: string, body: Record<string, unknown>, actor: Actor) {
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { id: true, job: { select: { leadId: true } } } });
  if (!permit) throw new PermitError(404, "Permit not found");
  if (body.type !== undefined && !isInspectionType(body.type)) throw new PermitError(400, "type is not an inspection type");
  const result = body.result ?? "SCHEDULED";
  if (!isInspectionResult(result)) throw new PermitError(400, "result is not an inspection result");
  const type = (body.type as PermitInspectionType | undefined) ?? "OTHER";

  const recorded = isRecordedResult(result);
  const created = await prisma.jobPermitInspection.create({
    data: {
      permitId,
      type,
      scheduledFor: readDate(body.scheduledFor, "scheduledFor") ?? null,
      completedAt: recorded ? null : (readDate(body.completedAt, "completedAt") ?? null),
      // A result given at creation goes through the same path as one recorded later.
      result: recorded ? "SCHEDULED" : result,
      inspectorName: text(body.inspectorName) ?? null,
      notes: text(body.notes) ?? null,
    },
  });
  await prisma.activityLog.create({
    data: {
      leadId: permit.job.leadId,
      activityType: "INSPECTION_SCHEDULED",
      title: `Inspection scheduled: ${type.replace(/_/g, " ")}`,
      description: created.scheduledFor ? `Scheduled for ${created.scheduledFor.toISOString().slice(0, 10)}` : undefined,
      createdByUserId: actor.id,
    },
  });
  if (!recorded) return { inspection: created, workflow: null as WorkflowOutcome | null, permitClosed: false };
  return recordPermitInspectionResult({ inspectionId: created.id, result, notes: created.notes, completedAt: readDate(body.completedAt, "completedAt") ?? null, ...stepChoice(body), actor });
}

export type WorkflowOutcome = {
  /** The workflow inspection step this result belongs to; null when the job has none for it. */
  taskId: string | null;
  /** The result was recorded on the step (it completed, or it is blocked on a correction). */
  applied: boolean;
  stepStatus: string | null;
  correctionTaskId: string | null;
};

/** Open inspection steps on the job's workflow that a permit inspection could belong to. */
export async function inspectionStepsForJob(jobId: string): Promise<(StepCandidate & { title: string })[]> {
  const rows = await prisma.task.findMany({
    where: {
      jobId,
      workflowInstance: { jobId, status: "ACTIVE" },
      workflowTaskKey: { not: null },
      requiredEvidence: "INSPECTION_RESULT",
      status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
      activatedAt: { not: null },
    },
    select: { id: true, title: true, status: true, workflowTaskKey: true, workflowSortOrder: true },
    orderBy: { workflowSortOrder: "asc" },
  });
  return rows.map((r) => ({ ...r, workflowTaskKey: r.workflowTaskKey as string }));
}

/**
 * Pass, fail or conditional on a permit inspection.
 *
 * The same entry is the workflow step's result when the job's workflow has a
 * step for it (`matchInspectionStep`, or the step the caller names): a fail
 * blocks the step and raises its correction task, a pass completes it when
 * one pass can (`resultAppliesToStep`). With no step to carry it, a fail or a
 * conditional pass still raises a correction task on the job — a failed
 * inspection never sits without one. A passed final closes the permit.
 *
 * `taskId`: a step id names the step, `null` says "no step", undefined lets
 * the match decide. `completesStep`: the person confirms this pass is the
 * last one a step that covers several inspections was waiting for.
 */
export async function recordPermitInspectionResult(input: {
  inspectionId: string;
  result: RecordedResult;
  notes?: string | null;
  completedAt?: Date | null;
  inspectorName?: string | null;
  taskId?: string | null;
  completesStep?: boolean;
  actor: Actor;
}) {
  const before = await prisma.jobPermitInspection.findUnique({
    where: { id: input.inspectionId },
    select: { id: true, type: true, result: true, notes: true, taskId: true, permit: { select: { id: true, jobId: true, permitType: true, assignedUserId: true, job: { select: { leadId: true, projectManagerId: true } } } } },
  });
  if (!before) throw new PermitError(404, "Inspection not found");
  const { actor } = input;
  const jobId = before.permit.jobId;
  const at = input.completedAt ?? new Date();
  const notes = input.notes === undefined ? before.notes : input.notes?.trim() || null;

  const inspection = await prisma.jobPermitInspection.update({
    where: { id: before.id },
    data: { result: input.result, completedAt: at, notes, inspectorName: input.inspectorName === undefined ? undefined : input.inspectorName },
  });
  await prisma.activityLog.create({
    data: {
      leadId: before.permit.job.leadId,
      activityType: input.result === "PASS" ? "INSPECTION_COMPLETED" : "INSPECTION_SCHEDULED",
      title: `Inspection ${before.type.replace(/_/g, " ")} → ${input.result}`,
      description: notes || undefined,
      createdByUserId: actor.id,
    },
  });
  await settleInspectionAlerts(before.id, actor.id);

  const permitClosed = (await closePermitIfFinalPassed(before.id, actor.id)) !== null;

  // ── The workflow step ──────────────────────────────────────────────────
  const steps = await inspectionStepsForJob(jobId);
  let step: StepCandidate | null;
  if (input.taskId === null) step = null;
  else if (input.taskId) {
    step = steps.find((s) => s.id === input.taskId) ?? null;
    if (!step) throw new PermitError(400, "That is not an open inspection step on this job's workflow");
  } else step = steps.find((s) => s.id === before.taskId) ?? matchInspectionStep(before.type, steps);

  const outcome: WorkflowOutcome = { taskId: step?.id ?? null, applied: false, stepStatus: step?.status ?? null, correctionTaskId: null };
  if (step) {
    const open = await prisma.jobPermit.count({ where: { jobId, status: { notIn: ["FINAL", "DENIED"] } } });
    if (resultAppliesToStep({ result: input.result, step, explicit: input.completesStep === true, allPermitsFinal: open === 0 })) {
      try {
        const r = await recordInspectionResult({ taskId: step.id, result: input.result, notes, inspectedAt: at, jobPermitInspectionId: before.id, actor });
        outcome.applied = true;
        outcome.stepStatus = r.status;
        outcome.correctionTaskId = r.correctionTaskId;
      } catch (err) {
        // The step would not take it (it closed meanwhile): the permit's record stands and the correction below still happens.
        if (!(err instanceof InspectionError)) throw err;
      }
    }
    if (!outcome.applied) await prisma.jobPermitInspection.update({ where: { id: before.id }, data: { taskId: step.id } });
  }

  // ── No step carried it: the correction is an ordinary task on the job ──
  if (!outcome.applied && input.result !== "PASS") {
    const sourceKey = `permit-inspection:${before.id}:correction`;
    const existing = await prisma.task.findFirst({ where: { sourceKey, status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true } });
    if (existing) outcome.correctionTaskId = existing.id;
    else {
      const assignee = (await userForJobRole(jobId, "SUPERINTENDENT")) ?? before.permit.job.projectManagerId ?? before.permit.assignedUserId;
      const what = `${words(before.type)} inspection${before.permit.permitType ? ` (${before.permit.permitType} permit)` : ""}`;
      const correction = await createTask(
        {
          title: input.result === "FAIL" ? `Correct failed inspection items — ${what}` : `Complete conditions — ${what}`,
          description: notes ? `Inspector notes: ${notes}` : null,
          priority: "HIGH",
          dueAt: atDueHour(addBusinessDaysFrom(at, 2)),
          assignedUserId: assignee,
          createdByUserId: actor.id,
          jobId,
          source: "auto",
          sourceKey,
        },
        { actorUserId: actor.id },
      );
      outcome.correctionTaskId = correction.id;
    }
  }

  await settleJobGates(jobId, actor.id);
  await recordAudit({
    actorUserId: actor.id,
    entityType: "JobPermitInspection",
    entityId: before.id,
    action: "inspection_result",
    before: { result: before.result },
    after: { result: input.result, notes, ...outcome, permitClosed },
  });
  return { inspection: { ...inspection, taskId: step?.id ?? inspection.taskId }, workflow: outcome, permitClosed };
}

export async function updatePermitInspection(id: string, body: Record<string, unknown>, actor: Actor) {
  const previous = await prisma.jobPermitInspection.findUnique({ where: { id }, select: { result: true } });
  if (!previous) throw new PermitError(404, "Inspection not found");
  if (body.type !== undefined && !isInspectionType(body.type)) throw new PermitError(400, "type is not an inspection type");
  if (body.result !== undefined && !isInspectionResult(body.result)) throw new PermitError(400, "result is not an inspection result");
  const result = body.result;
  const completedAt = readDate(body.completedAt, "completedAt");
  const recording = isRecordedResult(result) && result !== previous.result;

  const data: Prisma.JobPermitInspectionUncheckedUpdateInput = {
    type: body.type as PermitInspectionType | undefined,
    scheduledFor: readDate(body.scheduledFor, "scheduledFor"),
    inspectorName: text(body.inspectorName),
    notes: text(body.notes),
  };
  if (!recording) {
    data.completedAt = completedAt;
    if (result !== undefined) {
      data.result = result;
      // Cancelled, with no time given: now is when it ended. Back to scheduled: it has not happened.
      if (result === "CANCELLED" && completedAt === undefined && result !== previous.result) data.completedAt = new Date();
      if (result === "SCHEDULED" && completedAt === undefined) data.completedAt = null;
    }
  }
  const updated = await prisma.jobPermitInspection.update({ where: { id }, data });
  if (!recording) {
    // Cancelled or moved to another day: the "be ready" task for the old date closes.
    await settleInspectionAlerts(id, actor.id);
    return { inspection: updated, workflow: null as WorkflowOutcome | null, permitClosed: false };
  }
  return recordPermitInspectionResult({
    inspectionId: id,
    result,
    notes: updated.notes,
    completedAt: completedAt ?? null,
    ...stepChoice(body),
    actor,
  });
}
