import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { settleInspectionAlerts, settlePermitAlerts } from "./alert-run";
import { inspectionTypeForStep, passClosesPermit, statusStamps, typesForStep, type RecordedResult } from "./rules";

/**
 * What an inspection result does to the permit's own record. Shared by the
 * permit side (`service.ts`) and the workflow side
 * (`lib/workflows/inspections.ts`), so a result entered on either is on both.
 * Best-effort: the result itself was saved whatever happens here.
 */

/**
 * A passed final closes its permit: status FINAL and the final-passed date.
 * Returns the job id when the permit was closed, so the caller can settle
 * the job's gates.
 */
export async function closePermitIfFinalPassed(inspectionId: string, actorUserId: string): Promise<string | null> {
  try {
    const insp = await prisma.jobPermitInspection.findUnique({
      where: { id: inspectionId },
      select: {
        type: true,
        result: true,
        completedAt: true,
        permit: { select: { id: true, jobId: true, status: true, approvedDate: true, finalPassedDate: true, permitType: true, job: { select: { leadId: true } } } },
      },
    });
    if (!insp || insp.result !== "PASS") return null;
    const p = insp.permit;
    const otherScheduled = await prisma.jobPermitInspection.count({ where: { permitId: p.id, result: "SCHEDULED", id: { not: inspectionId } } });
    if (!passClosesPermit(insp.type, p.status, otherScheduled)) return null;
    const at = insp.completedAt ?? new Date();
    await prisma.jobPermit.update({ where: { id: p.id }, data: { status: "FINAL", ...statusStamps("FINAL", p, at) } });
    await prisma.activityLog.create({
      data: {
        leadId: p.job.leadId,
        activityType: "PERMIT_ADDED",
        title: "Permit status → FINAL",
        description: `${p.permitType ?? "Permit"}: final inspection passed`,
        createdByUserId: actorUserId,
      },
    });
    await settlePermitAlerts(p.id, actorUserId);
    return p.jobId;
  } catch (err) {
    logger.exception(err, { where: "permits.closePermitIfFinalPassed", inspectionId });
    return null;
  }
}

/**
 * A result recorded on a workflow inspection step is filed on the job's
 * permit: on the named permit inspection, else on the booked one this step
 * is waiting for, else as a new row when the job has one live permit to put
 * it on. Returns the permit inspection's id, or null when the job has no
 * single permit it could belong to.
 */
export async function fileStepResultOnPermit(input: {
  taskId: string;
  taskKey: string;
  jobId: string;
  result: RecordedResult;
  at: Date;
  notes: string | null;
  inspectionId?: string | null;
}): Promise<string | null> {
  try {
    const data = { result: input.result, completedAt: input.at, notes: input.notes ?? undefined, taskId: input.taskId };
    if (input.inspectionId) {
      // Only a row on this job's own permits.
      const n = await prisma.jobPermitInspection.updateMany({ where: { id: input.inspectionId, permit: { jobId: input.jobId } }, data });
      if (n.count > 0) await settleInspectionAlerts(input.inspectionId, null);
      return n.count > 0 ? input.inspectionId : null;
    }
    const types = typesForStep(input.taskKey);
    const booked = await prisma.jobPermitInspection.findFirst({
      where: {
        result: "SCHEDULED",
        permit: { jobId: input.jobId },
        OR: [{ taskId: input.taskId }, ...(types.length ? [{ taskId: null, type: { in: types } }] : [])],
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (booked) {
      await prisma.jobPermitInspection.update({ where: { id: booked.id }, data });
      await settleInspectionAlerts(booked.id, null);
      return booked.id;
    }
    const live = await prisma.jobPermit.findMany({
      where: { jobId: input.jobId, status: { in: ["APPLIED", "IN_PROGRESS", "ISSUED"] } },
      select: { id: true },
      take: 2,
    });
    if (live.length !== 1) return null;
    const created = await prisma.jobPermitInspection.create({
      data: { permitId: live[0].id, type: inspectionTypeForStep(input.taskKey), ...data, notes: input.notes },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    logger.exception(err, { where: "permits.fileStepResultOnPermit", taskId: input.taskId });
    return null;
  }
}
