import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { emitLeadEvent } from "@/lib/follow-ups/events";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";

const schema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(200),
  stageId: z.string().min(1),
  reason: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const { leadIds, stageId, reason } = v.data;

  const stage = await prisma.leadStage.findUnique({ where: { id: stageId } });
  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 400 });

  let updated = 0;
  for (const leadId of leadIds) {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, currentStageId: true },
      });
      if (!lead) continue;
      if (lead.currentStageId === stageId) continue;

      await Promise.all([
        prisma.lead.update({ where: { id: leadId }, data: { currentStageId: stageId } }),
        prisma.leadStageHistory.create({
          data: {
            leadId,
            fromStageId: lead.currentStageId,
            toStageId: stageId,
            changedByUserId: session.user.id,
            reason: reason ?? null,
          },
        }),
        prisma.activityLog.create({
          data: {
            leadId,
            activityType: "STAGE_CHANGE",
            title: `Stage changed to ${stage.name}`,
            description: reason ?? undefined,
            metadataJson: { fromStageId: lead.currentStageId, toStageId: stageId, bulk: true },
            createdByUserId: session.user.id,
          },
        }),
      ]);

      await recordAudit({
        actorUserId: session.user.id,
        entityType: "Lead",
        entityId: leadId,
        action: "stage_change",
        before: { stageId: lead.currentStageId },
        after: { stageId, reason: reason ?? null, bulk: true },
      });

      await emitLeadEvent("LEAD_STAGE_CHANGED", leadId).catch((e) =>
        logger.exception(e, { where: "bulk-stage.emitLeadEvent", leadId }),
      );
      updated++;
    } catch (err) {
      logger.exception(err, { where: "bulk-stage", leadId });
    }
  }

  return NextResponse.json({ updated, requested: leadIds.length });
}
