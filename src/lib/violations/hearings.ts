import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { rescheduleAnchor } from "@/lib/workflows/reschedule";
import { auditCase } from "./audit";
import { changeDeadline } from "./deadline";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";
import { recordFineEntry } from "./fine-ledger";

type Actor = { id: string; role: RoleName };
const HEARING_INCLUDE = { attendee: { select: { id: true, firstName: true, lastName: true } } } as const;

/** `nextHearingAt` is denormalised on the case and is the HEARING_DATE anchor; every hearing write recomputes it. */
export async function recomputeNextHearing(caseId: string, actorUserId: string): Promise<void> {
  const [c, next] = await Promise.all([
    prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { nextHearingAt: true, workflow: { select: { id: true } } } }),
    prisma.codeViolationHearing.findFirst({ where: { caseId, status: { in: ["SCHEDULED", "CONTINUED"] }, outcome: null }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
  ]);
  if (!c) return;
  const at = next?.scheduledAt ?? null;
  if ((c.nextHearingAt?.getTime() ?? null) === (at?.getTime() ?? null)) return;
  await prisma.codeViolationCase.update({ where: { id: caseId }, data: { nextHearingAt: at, ...(at ? { hearingRequired: true } : {}) } });
  if (c.workflow) await rescheduleAnchor(c.workflow.id, "HEARING_DATE", actorUserId);
}

export async function scheduleHearing(caseId: string, body: { type?: Prisma.CodeViolationHearingCreateInput["type"]; scheduledAt: string; location?: string | null; attendeeUserId?: string | null; caseNumberAtHearing?: string | null; notes?: string | null }, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new ViolationError(400, "Invalid hearing date");
  const row = await prisma.codeViolationHearing.create({
    data: { caseId, type: body.type ?? "SPECIAL_MAGISTRATE", scheduledAt, location: body.location ?? null, attendeeUserId: body.attendeeUserId ?? null, caseNumberAtHearing: body.caseNumberAtHearing ?? null, notes: body.notes ?? null, createdByUserId: actor.id },
    include: HEARING_INCLUDE,
  });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "HEARING_SCHEDULED", toValue: scheduledAt.toISOString(), body: [row.type.toLowerCase().replace(/_/g, " "), body.location].filter(Boolean).join(" · ") });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationHearing", entityId: row.id, action: "violation_hearing_scheduled", after: { caseId, type: row.type, scheduledAt: scheduledAt.toISOString(), attendeeUserId: body.attendeeUserId ?? null } });
  await recomputeNextHearing(caseId, actor.id);
  return row;
}

export async function updateHearing(
  caseId: string,
  hearingId: string,
  body: {
    type?: Prisma.CodeViolationHearingUpdateInput["type"];
    status?: "SCHEDULED" | "CONTINUED" | "HELD" | "CANCELLED";
    scheduledAt?: string;
    location?: string | null;
    attendeeUserId?: string | null;
    notes?: string | null;
    outcome?: Prisma.CodeViolationHearingUpdateInput["outcome"] | null;
    outcomeNotes?: string | null;
    orderDeadline?: string | null;
    orderedFineAmount?: string | null;
    orderedDailyFine?: string | null;
    orderFileId?: string | null;
    applyOrderDeadline?: boolean;
    continueTo?: { scheduledAt: string; location?: string | null };
  },
  actor: Actor,
) {
  const before = await prisma.codeViolationHearing.findUnique({ where: { id: hearingId } });
  if (!before || before.caseId !== caseId) throw new ViolationError(404, "Hearing not found");
  const data: Prisma.CodeViolationHearingUncheckedUpdateInput = {};
  if (body.type !== undefined) data.type = body.type as never;
  if (body.status !== undefined) data.status = body.status;
  if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt);
  if (body.location !== undefined) data.location = body.location;
  if (body.attendeeUserId !== undefined) data.attendeeUserId = body.attendeeUserId;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.outcomeNotes !== undefined) data.outcomeNotes = body.outcomeNotes;
  if (body.orderDeadline !== undefined) data.orderDeadline = body.orderDeadline ? parseDueAt(body.orderDeadline) : null;
  if (body.orderedFineAmount !== undefined) data.orderedFineAmount = body.orderedFineAmount;
  if (body.orderedDailyFine !== undefined) data.orderedDailyFine = body.orderedDailyFine;
  if (body.orderFileId !== undefined) data.orderFileId = body.orderFileId;
  const outcomeRecorded = body.outcome !== undefined && body.outcome !== null && body.outcome !== before.outcome;
  if (body.outcome !== undefined) {
    data.outcome = body.outcome as never;
    if (body.outcome && !body.status) data.status = "HELD";
  }
  let continued: { id: string } | null = null;
  if (body.continueTo) {
    continued = await prisma.codeViolationHearing.create({
      data: { caseId, type: before.type, scheduledAt: new Date(body.continueTo.scheduledAt), location: body.continueTo.location ?? before.location, attendeeUserId: before.attendeeUserId, caseNumberAtHearing: before.caseNumberAtHearing, createdByUserId: actor.id },
      select: { id: true },
    });
    data.status = "CONTINUED";
    data.continuedToId = continued.id;
    if (data.outcome === undefined) data.outcome = "CONTINUED";
  }
  const row = await prisma.codeViolationHearing.update({ where: { id: hearingId }, data, include: HEARING_INCLUDE });

  if (outcomeRecorded || continued) {
    await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "HEARING_RESULT", toValue: row.outcome, body: body.outcomeNotes ?? null });
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationHearing", entityId: hearingId, action: "violation_hearing_outcome", before: { outcome: before.outcome, status: before.status }, after: { caseId, outcome: row.outcome, status: row.status, orderedFineAmount: body.orderedFineAmount ?? null, orderedDailyFine: body.orderedDailyFine ?? null, orderDeadline: body.orderDeadline ?? null, continuedToId: continued?.id ?? null } });
    if (body.orderedFineAmount && Number(body.orderedFineAmount) > 0) {
      await recordFineEntry(caseId, { type: "FINE_IMPOSED", amount: body.orderedFineAmount, effectiveAt: new Date(row.scheduledAt).toISOString().slice(0, 10), reference: `Hearing ${hearingId}`, notes: "Imposed at the hearing" }, actor);
    }
    if (body.orderedDailyFine && Number(body.orderedDailyFine) > 0) {
      await recordFineEntry(caseId, { type: "ACCRUAL_STARTED", amount: body.orderedDailyFine, effectiveAt: (body.orderDeadline ? parseDueAt(body.orderDeadline) : new Date(row.scheduledAt)).toISOString().slice(0, 10), reference: `Hearing ${hearingId}`, notes: "Daily fine ordered at the hearing" }, actor);
    }
    if (body.orderDeadline && body.applyOrderDeadline) {
      await changeDeadline({ caseId, newDeadline: parseDueAt(body.orderDeadline), kind: "HEARING_ORDER", reason: body.outcomeNotes?.trim() || "Deadline set by the hearing order", reference: `Hearing ${hearingId}`, actor });
    }
  } else {
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationHearing", entityId: hearingId, action: "violation_hearing_updated", before: { scheduledAt: before.scheduledAt.toISOString(), status: before.status, attendeeUserId: before.attendeeUserId }, after: { caseId, scheduledAt: row.scheduledAt.toISOString(), status: row.status, attendeeUserId: row.attendeeUserId } });
    if (body.scheduledAt && new Date(body.scheduledAt).getTime() !== before.scheduledAt.getTime()) {
      await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "HEARING_SCHEDULED", fromValue: before.scheduledAt.toISOString(), toValue: row.scheduledAt.toISOString(), body: "rescheduled" });
    }
  }
  await recomputeNextHearing(caseId, actor.id);
  return row;
}
