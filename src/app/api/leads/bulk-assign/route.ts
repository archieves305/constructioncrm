import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { emitLeadEvent } from "@/lib/follow-ups/events";
import { logger } from "@/lib/logger";

const schema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(200),
  assignedUserId: z.string().min(1),
  reason: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const { leadIds, assignedUserId, reason } = v.data;

  const assignee = await prisma.user.findUnique({
    where: { id: assignedUserId },
    select: { id: true, firstName: true, lastName: true, isActive: true },
  });
  if (!assignee || !assignee.isActive) {
    return NextResponse.json({ error: "Assignee not found or inactive" }, { status: 400 });
  }

  let updated = 0;
  for (const leadId of leadIds) {
    try {
      await prisma.$transaction(async (tx) => {
        const lead = await tx.lead.findUnique({
          where: { id: leadId },
          select: { id: true, assignedUserId: true },
        });
        if (!lead) return;

        if (lead.assignedUserId) {
          await tx.leadAssignment.updateMany({
            where: { leadId, unassignedAt: null },
            data: { unassignedAt: new Date() },
          });
        }

        await tx.leadAssignment.create({
          data: {
            leadId,
            assignedUserId,
            assignedByUserId: session.user.id,
            reason: reason ?? null,
          },
        });

        await tx.lead.update({
          where: { id: leadId },
          data: { assignedUserId },
        });

        await tx.activityLog.create({
          data: {
            leadId,
            activityType: "ASSIGNMENT_CHANGE",
            title: `Bulk assigned to ${assignee.firstName} ${assignee.lastName}`,
            description: reason ?? undefined,
            createdByUserId: session.user.id,
          },
        });
      });

      await emitLeadEvent("LEAD_ASSIGNED", leadId).catch((e) =>
        logger.exception(e, { where: "bulk-assign.emitLeadEvent", leadId }),
      );
      updated++;
    } catch (err) {
      logger.exception(err, { where: "bulk-assign", leadId });
    }
  }

  return NextResponse.json({ updated, requested: leadIds.length });
}
