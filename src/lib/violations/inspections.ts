import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { InspectionError, recordInspectionResult } from "@/lib/workflows/inspections";
import { auditCase } from "./audit";
import { confirmAgency } from "./close";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";
import { reopenItems, verifyItems } from "./items";

type Actor = { id: string; role: RoleName };
const INSPECTION_INCLUDE = { attendee: { select: { id: true, firstName: true, lastName: true } } } as const;

/** Request (and optionally schedule) an agency inspection. A reinspection request marks the case as awaiting the agency. */
export async function requestInspection(caseId: string, body: { kind?: "INITIAL" | "REINSPECTION" | "FINAL"; scheduledFor?: string | null; attendeeUserId?: string | null; inspectorName?: string | null; notes?: string | null; requestsReinspection?: boolean }, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { id: true, reinspectionRequestedAt: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const kind = body.kind ?? "REINSPECTION";
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
  const now = new Date();
  const row = await prisma.codeViolationInspection.create({
    data: { caseId, kind, status: scheduledFor ? "SCHEDULED" : "REQUESTED", requestedAt: now, requestedByUserId: actor.id, scheduledFor, attendeeUserId: body.attendeeUserId ?? null, inspectorName: body.inspectorName ?? null, notes: body.notes ?? null },
    include: INSPECTION_INCLUDE,
  });
  const marks = body.requestsReinspection ?? kind !== "INITIAL";
  if (marks && !c.reinspectionRequestedAt) await prisma.codeViolationCase.update({ where: { id: caseId }, data: { reinspectionRequestedAt: now } });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "INSPECTION_REQUESTED", toValue: scheduledFor?.toISOString() ?? null, body: `${kind.toLowerCase()} inspection ${scheduledFor ? "scheduled" : "requested"}` });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationInspection", entityId: row.id, action: scheduledFor ? "violation_inspection_scheduled" : "violation_inspection_requested", after: { caseId, kind, scheduledFor: scheduledFor?.toISOString() ?? null, attendeeUserId: body.attendeeUserId ?? null } });
  return row;
}

export async function updateInspection(caseId: string, inspectionId: string, body: { status?: "REQUESTED" | "SCHEDULED" | "COMPLETED" | "CANCELLED"; scheduledFor?: string | null; attendeeUserId?: string | null; inspectorName?: string | null; notes?: string | null; reportFileId?: string | null }, actor: Actor) {
  const before = await prisma.codeViolationInspection.findUnique({ where: { id: inspectionId } });
  if (!before || before.caseId !== caseId) throw new ViolationError(404, "Inspection not found");
  const data: Prisma.CodeViolationInspectionUncheckedUpdateInput = {};
  if (body.scheduledFor !== undefined) {
    data.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
    if (body.scheduledFor && before.status === "REQUESTED" && !body.status) data.status = "SCHEDULED";
  }
  if (body.status !== undefined) data.status = body.status;
  if (body.attendeeUserId !== undefined) data.attendeeUserId = body.attendeeUserId;
  if (body.inspectorName !== undefined) data.inspectorName = body.inspectorName;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.reportFileId !== undefined) data.reportFileId = body.reportFileId;
  const row = await prisma.codeViolationInspection.update({ where: { id: inspectionId }, data, include: INSPECTION_INCLUDE });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationInspection", entityId: inspectionId, action: "violation_inspection_updated", before: { status: before.status, scheduledFor: before.scheduledFor?.toISOString() ?? null }, after: { caseId, status: row.status, scheduledFor: row.scheduledFor?.toISOString() ?? null, attendeeUserId: row.attendeeUserId } });
  if (body.scheduledFor && (before.scheduledFor?.getTime() ?? null) !== row.scheduledFor?.getTime()) {
    await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "INSPECTION_REQUESTED", toValue: row.scheduledFor?.toISOString() ?? null, body: `${row.kind.toLowerCase()} inspection scheduled` });
  }
  return row;
}

/**
 * The agency came out. FAIL re-cites items (they reopen) and, when the
 * result is recorded on a workflow step, blocks that step and creates the
 * correction task through the engine — which reopens the step when the
 * corrections close. PASS verifies the accepted items; it only counts as the
 * agency's confirmation when an ADMIN/MANAGER says so (`confirmsAgency`).
 */
export async function recordAgencyInspectionResult(
  caseId: string,
  inspectionId: string,
  body: { result: "PASS" | "FAIL" | "CONDITIONAL"; completedAt?: string; notes?: string | null; inspectorName?: string | null; failedItemIds: string[]; verifiedItemIds?: string[]; taskId?: string | null; reportFileId?: string | null; confirmsAgency?: boolean },
  actor: Actor,
) {
  const insp = await prisma.codeViolationInspection.findUnique({ where: { id: inspectionId } });
  if (!insp || insp.caseId !== caseId) throw new ViolationError(404, "Inspection not found");
  if (insp.result) throw new ViolationError(409, "This inspection already has a result");
  if (body.failedItemIds.length > 0) {
    const n = await prisma.codeViolationItem.count({ where: { caseId, id: { in: body.failedItemIds } } });
    if (n !== body.failedItemIds.length) throw new ViolationError(400, "Every re-cited item must belong to this case");
  }
  const completedAt = body.completedAt ? parseDueAt(body.completedAt) : new Date();
  const notes = body.notes?.trim() || null;

  await prisma.codeViolationInspection.update({
    where: { id: inspectionId },
    data: { result: body.result, status: "COMPLETED", completedAt, notes: notes ?? undefined, inspectorName: body.inspectorName ?? undefined, failedItemIds: body.failedItemIds, reportFileId: body.reportFileId ?? undefined, taskId: body.taskId ?? undefined },
  });
  await prisma.codeViolationCase.update({ where: { id: caseId }, data: { finalInspectionResult: body.result } });

  let reopened = 0;
  let verified = 0;
  if (body.result === "FAIL" || body.result === "CONDITIONAL") reopened = await reopenItems(caseId, body.failedItemIds, actor, `re-cited at the ${insp.kind.toLowerCase()} inspection`);
  if (body.result === "PASS") verified = await verifyItems(caseId, body.verifiedItemIds ?? null, actor, `accepted at the ${insp.kind.toLowerCase()} inspection`);
  else if (body.verifiedItemIds?.length) verified = await verifyItems(caseId, body.verifiedItemIds, actor, `accepted at the ${insp.kind.toLowerCase()} inspection`);

  let correctionTaskId: string | null = null;
  let stepStatus: string | null = null;
  if (body.taskId) {
    try {
      const r = await recordInspectionResult({ taskId: body.taskId, result: body.result, notes, inspectedAt: completedAt, violationInspectionId: inspectionId, actor });
      correctionTaskId = r.correctionTaskId;
      stepStatus = r.status;
      // Tie the correction task to the single re-cited item, when there is exactly one.
      if (correctionTaskId && body.failedItemIds.length === 1) await prisma.task.update({ where: { id: correctionTaskId }, data: { violationItemId: body.failedItemIds[0] } });
    } catch (err) {
      if (err instanceof InspectionError) throw new ViolationError(err.status, err.message);
      throw err;
    }
  }

  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "INSPECTION_RESULT", toValue: body.result, body: `${insp.kind.toLowerCase()} inspection ${body.result.toLowerCase()}${reopened ? ` — ${reopened} item${reopened === 1 ? "" : "s"} reopened` : ""}${verified ? ` — ${verified} verified` : ""}${notes ? ` — ${notes}` : ""}` });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationInspection", entityId: inspectionId, action: "violation_inspection_result", after: { caseId, result: body.result, completedAt: completedAt.toISOString(), failedItemIds: body.failedItemIds, verifiedItemIds: body.verifiedItemIds ?? null, taskId: body.taskId ?? null, correctionTaskId, confirmsAgency: Boolean(body.confirmsAgency) }, reason: notes });

  if (body.result === "PASS" && body.confirmsAgency) {
    await confirmAgency(caseId, { confirmedAt: completedAt.toISOString().slice(0, 10), confirmedByName: body.inspectorName ?? insp.inspectorName ?? null, method: "inspection", reference: `Inspection ${inspectionId}`, fileId: body.reportFileId ?? null }, actor, "inspection");
  }
  return { result: body.result, reopened, verified, correctionTaskId, stepStatus };
}
