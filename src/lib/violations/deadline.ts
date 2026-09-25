import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { loadScheduleContext } from "@/lib/workflows/activation";
import { rescheduleAnchor } from "@/lib/workflows/reschedule";
import { recomputeAfterAnchorChange } from "@/lib/workflows/schedule";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";

type Actor = { id: string; role: RoleName };

export type DeadlineMove = { taskId: string; key: string | null; title: string; oldDueAt: Date | null; newDueAt: Date | null; locked: boolean };

/**
 * What moving the compliance deadline would do to the workflow: every open
 * step anchored to it gets a new date, hand-edited (locked) dates are listed
 * as kept. Nothing is written.
 */
export async function previewDeadlineChange(caseId: string, newDeadline: Date): Promise<{ current: Date | null; moves: DeadlineMove[] }> {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { currentDeadline: true, workflow: { select: { id: true } } } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (!c.workflow) return { current: c.currentDeadline, moves: [] };
  const ctx = await loadScheduleContext(prisma, c.workflow.id);
  if (!ctx) return { current: c.currentDeadline, moves: [] };
  const tasks = await prisma.task.findMany({
    where: { workflowInstanceId: c.workflow.id, workflowAnchor: "COMPLIANCE_DEADLINE", status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } },
    select: { id: true, title: true, status: true, dueAt: true, dueLocked: true, activatedAt: true, workflowTaskKey: true, dueOffsetBusinessDays: true },
  });
  const next = { ...ctx, complianceDeadline: newDeadline };
  const moved = new Map(
    recomputeAfterAnchorChange(
      tasks.map((t) => ({ id: t.id, status: t.status, dueLocked: t.dueLocked, activatedAt: t.activatedAt, anchor: "COMPLIANCE_DEADLINE" as const, dueOffsetBusinessDays: t.dueOffsetBusinessDays ?? 0 })),
      next,
      "COMPLIANCE_DEADLINE",
    ).map((m) => [m.id, m.dueAt]),
  );
  return {
    current: c.currentDeadline,
    moves: tasks.map((t) => ({ taskId: t.id, key: t.workflowTaskKey, title: t.title, oldDueAt: t.dueAt, newDueAt: t.dueLocked ? t.dueAt : (moved.get(t.id) ?? t.dueAt), locked: t.dueLocked })),
  };
}

export async function changeDeadline(input: { caseId: string; newDeadline: Date; kind: string; reason: string; reference?: string | null; actor: Actor }) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: input.caseId }, select: { currentDeadline: true, originalDeadline: true, workflow: { select: { id: true } } } });
  if (!c) throw new ViolationError(404, "Case not found");
  await prisma.codeViolationCase.update({
    where: { id: input.caseId },
    data: { currentDeadline: input.newDeadline, ...(c.originalDeadline ? {} : { originalDeadline: input.newDeadline }) },
  });
  const moved = c.workflow ? await rescheduleAnchor(c.workflow.id, "COMPLIANCE_DEADLINE", input.actor.id) : 0;
  await recordCaseEvent(prisma, { caseId: input.caseId, actorUserId: input.actor.id, type: "DEADLINE_CHANGED", fromValue: c.currentDeadline?.toISOString() ?? null, toValue: input.newDeadline.toISOString(), body: `${input.kind.toLowerCase().replace(/_/g, " ")} — ${input.reason}${input.reference ? ` (${input.reference})` : ""}` });
  await auditCase({
    actorUserId: input.actor.id,
    entityType: "CodeViolationCase",
    entityId: input.caseId,
    action: "violation_deadline_change",
    before: { currentDeadline: c.currentDeadline?.toISOString() ?? null },
    after: { currentDeadline: input.newDeadline.toISOString(), kind: input.kind, reference: input.reference ?? null, rescheduledTasks: moved },
    reason: input.reason,
  });
  return { moved };
}

export async function requestExtension(caseId: string, body: { requestedDeadline: string; reason?: string | null; requestFileId?: string | null }, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const requestedDeadline = parseDueAt(body.requestedDeadline);
  const now = new Date();
  const row = await prisma.codeViolationExtension.create({ data: { caseId, requestedAt: now, requestedDeadline, reason: body.reason ?? null, requestFileId: body.requestFileId ?? null, createdByUserId: actor.id } });
  await prisma.codeViolationCase.update({ where: { id: caseId }, data: { extensionStatus: "REQUESTED", extensionRequestedAt: now, extensionDeadline: requestedDeadline } });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "EXTENSION_REQUESTED", toValue: requestedDeadline.toISOString(), body: body.reason ?? null });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationExtension", entityId: row.id, action: "violation_extension", after: { caseId, status: "REQUESTED", requestedDeadline: requestedDeadline.toISOString() }, reason: body.reason ?? null });
  return row;
}

/** Granting an extension IS a deadline change, and goes through the same path (and preview). */
export async function decideExtension(caseId: string, extensionId: string, body: { status: "GRANTED" | "DENIED" | "WITHDRAWN"; grantedDeadline?: string | null; decisionNotes?: string | null }, actor: Actor) {
  const ext = await prisma.codeViolationExtension.findUnique({ where: { id: extensionId } });
  if (!ext || ext.caseId !== caseId) throw new ViolationError(404, "Extension not found");
  if (ext.status !== "REQUESTED") throw new ViolationError(409, "This extension request was already decided");
  const now = new Date();
  const granted = body.status === "GRANTED" ? (body.grantedDeadline ? parseDueAt(body.grantedDeadline) : ext.requestedDeadline) : null;
  const row = await prisma.codeViolationExtension.update({ where: { id: extensionId }, data: { status: body.status, decidedAt: now, grantedDeadline: granted, decisionNotes: body.decisionNotes ?? null } });
  await prisma.codeViolationCase.update({ where: { id: caseId }, data: { extensionStatus: body.status, extensionDeadline: granted } });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "EXTENSION_DECIDED", toValue: body.status, body: body.decisionNotes ?? null });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationExtension", entityId: extensionId, action: "violation_extension", before: { status: "REQUESTED" }, after: { status: body.status, grantedDeadline: granted?.toISOString() ?? null }, reason: body.decisionNotes ?? null });
  let moved = 0;
  if (granted) {
    const r = await changeDeadline({ caseId, newDeadline: granted, kind: "EXTENSION_GRANTED", reason: body.decisionNotes?.trim() || "Extension granted by the agency", actor });
    moved = r.moved;
  }
  return { extension: row, moved };
}
