import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createJobFromLead } from "@/lib/services/jobs";
import { emitLeadEvent } from "@/lib/follow-ups/events";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const { stageId, reason } = await request.json();

  if (!stageId) return badRequest("stageId is required");

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { currentStageId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const newStage = await prisma.leadStage.findUnique({ where: { id: stageId } });
  if (!newStage) return badRequest("Invalid stage");

  // Update lead and create history
  const [updated] = await Promise.all([
    prisma.lead.update({
      where: { id },
      data: { currentStageId: stageId },
      include: { currentStage: true },
    }),
    prisma.leadStageHistory.create({
      data: {
        leadId: id,
        fromStageId: lead.currentStageId,
        toStageId: stageId,
        changedByUserId: session.user.id,
        reason,
      },
    }),
    prisma.activityLog.create({
      data: {
        leadId: id,
        activityType: "STAGE_CHANGE",
        title: `Stage changed to ${newStage.name}`,
        description: reason || undefined,
        metadataJson: {
          fromStageId: lead.currentStageId,
          toStageId: stageId,
        },
        createdByUserId: session.user.id,
      },
    }),
  ]);

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Lead",
    entityId: id,
    action: "stage_change",
    before: { stageId: lead.currentStageId },
    after: { stageId, reason: reason ?? null },
    ipAddress: request.headers.get("x-forwarded-for") ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  await emitLeadEvent("LEAD_STAGE_CHANGED", id).catch((e) =>
    logger.exception(e, { where: "emitLeadEvent", event: "LEAD_STAGE_CHANGED", leadId: id }),
  );

  // Auto-create job when lead is Won
  let job = null;
  if (newStage.isWon) {
    try {
      job = await createJobFromLead(id, session.user.id);
    } catch (err) {
      logger.exception(err, { where: "createJobFromLead", leadId: id });
    }
  }

  return NextResponse.json({ ...updated, job });
}
