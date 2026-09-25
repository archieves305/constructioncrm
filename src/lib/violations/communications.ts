import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";

type Actor = { id: string; role: RoleName };

/** A call, text or email about the case. Lead-scoped like every Communication, tagged with the case. */
export async function logCaseCommunication(caseId: string, body: { communicationType: "SMS" | "CALL" | "EMAIL"; direction?: "INBOUND" | "OUTBOUND"; toValue?: string | null; subject?: string | null; body: string }, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { leadId: true, caseNumber: true, officerName: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const now = new Date();
  const direction = body.direction ?? "OUTBOUND";
  const row = await prisma.communication.create({
    data: {
      leadId: c.leadId,
      violationCaseId: caseId,
      communicationType: body.communicationType,
      direction,
      fromValue: direction === "OUTBOUND" ? "CRM User" : (body.toValue ?? c.officerName ?? "Agency"),
      toValue: direction === "OUTBOUND" ? (body.toValue ?? c.officerName ?? "Agency") : "CRM User",
      subject: body.subject ?? null,
      body: body.body.trim(),
      status: direction === "OUTBOUND" ? "SENT" : "RECEIVED",
      sentAt: direction === "OUTBOUND" ? now : null,
      receivedAt: direction === "INBOUND" ? now : null,
      createdByUserId: actor.id,
    },
  });
  const activityType = body.communicationType === "CALL" ? "CALL_LOGGED" : body.communicationType === "SMS" ? "SMS_LOGGED" : "EMAIL_LOGGED";
  await prisma.activityLog.create({ data: { leadId: c.leadId, activityType, title: `${body.communicationType} logged on ${c.caseNumber}`, description: body.body.trim().slice(0, 500), createdByUserId: actor.id } });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "COMMUNICATION_LOGGED", toValue: body.communicationType, body: `${direction === "INBOUND" ? "From" : "To"} ${row.direction === "OUTBOUND" ? row.toValue : row.fromValue}: ${body.body.trim().slice(0, 200)}` });
  return row;
}
