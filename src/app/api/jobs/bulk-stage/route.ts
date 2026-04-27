import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { changeJobStage } from "@/lib/services/jobs";
import { logger } from "@/lib/logger";

const schema = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(200),
  stageId: z.string().min(1),
  reason: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const { jobIds, stageId, reason } = v.data;

  const stage = await prisma.jobStage.findUnique({ where: { id: stageId } });
  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 400 });

  let updated = 0;
  for (const jobId of jobIds) {
    try {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, currentStageId: true },
      });
      if (!job) continue;
      if (job.currentStageId === stageId) continue;

      await changeJobStage(jobId, stageId, session.user.id, reason ?? undefined);

      await recordAudit({
        actorUserId: session.user.id,
        entityType: "Job",
        entityId: jobId,
        action: "stage_change",
        before: { stageId: job.currentStageId },
        after: { stageId, bulk: true, reason: reason ?? null },
      });

      updated++;
    } catch (err) {
      logger.exception(err, { where: "jobs.bulk-stage", jobId });
    }
  }

  return NextResponse.json({ updated, requested: jobIds.length });
}
