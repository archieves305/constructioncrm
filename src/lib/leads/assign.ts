import { prisma } from "@/lib/db/prisma";
import { emitLeadEvent } from "@/lib/follow-ups/events";
import { logger } from "@/lib/logger";

/** Reassigning a lead: ADMIN / MANAGER (the assign route and the edit form alike). */
export function canAssignLeads(role: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/**
 * Give a lead to someone (or to nobody): the one path, so every change leaves
 * an assignment row, an activity line and the LEAD_ASSIGNED event — whether it
 * came from the assign button, the bulk assign or the edit form.
 */
export async function assignLead(leadId: string, assignedUserId: string | null, actorUserId: string, reason?: string | null) {
  await prisma.leadAssignment.updateMany({ where: { leadId, unassignedAt: null }, data: { unassignedAt: new Date() } });
  if (assignedUserId) {
    await prisma.leadAssignment.create({ data: { leadId, assignedUserId, assignedByUserId: actorUserId, reason: reason ?? undefined } });
  }
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { assignedUserId },
    include: { assignedUser: { select: { id: true, firstName: true, lastName: true } } },
  });
  await prisma.activityLog.create({
    data: {
      leadId,
      activityType: "ASSIGNMENT_CHANGE",
      title: updated.assignedUser ? `Assigned to ${updated.assignedUser.firstName} ${updated.assignedUser.lastName}` : "Unassigned",
      description: reason || undefined,
      createdByUserId: actorUserId,
    },
  });
  if (assignedUserId) {
    await emitLeadEvent("LEAD_ASSIGNED", leadId).catch((e) => logger.exception(e, { where: "emitLeadEvent", event: "LEAD_ASSIGNED", leadId }));
  }
  return updated;
}
