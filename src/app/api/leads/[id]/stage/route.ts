import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { createJobFromLead } from "@/lib/services/jobs";
import { emitLeadEvent } from "@/lib/follow-ups/events";
import { onLeadStageChanged } from "@/lib/nurture/hooks";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";
import { guardLead } from "@/lib/access/records";
import { z } from "zod";

const estimateRefSchema = z.object({ kind: z.enum(["GENERIC", "ROOF"]), id: z.string().min(1) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardLead(session.user, id, "write");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { stageId?: string; reason?: string; estimate?: unknown };
  const { stageId, reason } = body;
  // At Won, the estimate the job's price and cost come from (the Won dialog's pick):
  // { kind, id }, or null for none. Absent: the one estimate marked Accepted, if exactly one is.
  const estimate = body.estimate === undefined ? undefined : body.estimate === null ? null : estimateRefSchema.safeParse(body.estimate);
  if (estimate && "success" in estimate && !estimate.success) return badRequest("estimate must be { kind: GENERIC | ROOF, id }");

  if (!stageId) return badRequest("stageId is required");

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { currentStageId: true, kind: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  // A GC bid package's stage mirrors its bid (Won on award, Lost on a loss);
  // moving it by hand would put the Leads board and the bid out of step.
  if (lead.kind === "GC_BID") {
    return NextResponse.json({ error: "This lead is a bid package; change the bid's status instead", hint: `/leads/${id}?tab=bid` }, { status: 409 });
  }

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

  await onLeadStageChanged(id, newStage);
  await emitLeadEvent("LEAD_STAGE_CHANGED", id, { targetStageId: stageId }).catch((e) =>
    logger.exception(e, { where: "emitLeadEvent", event: "LEAD_STAGE_CHANGED", leadId: id }),
  );

  // Auto-create job when lead is Won
  let job = null;
  let jobError: string | null = null;
  if (newStage.isWon) {
    try {
      job = await createJobFromLead(id, session.user.id, {
        fromEstimate: estimate === undefined ? undefined : estimate === null ? null : estimate.data,
      });
    } catch (err) {
      logger.exception(err, { where: "createJobFromLead", leadId: id });
      // The lead is Won either way; say so, so nobody assumes the job exists.
      jobError = err instanceof Error ? err.message : "The job could not be created";
    }
  }

  return NextResponse.json({ ...updated, job, jobError });
}
