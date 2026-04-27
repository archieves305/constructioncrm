import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";

const schema = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(200),
  salesRepId: z.string().min(1),
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
  const { jobIds, salesRepId, reason } = v.data;

  const assignee = await prisma.user.findUnique({
    where: { id: salesRepId },
    select: { id: true, firstName: true, lastName: true, isActive: true },
  });
  if (!assignee || !assignee.isActive) {
    return NextResponse.json({ error: "Assignee not found or inactive" }, { status: 400 });
  }

  let updated = 0;
  for (const jobId of jobIds) {
    try {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, leadId: true, salesRepId: true },
      });
      if (!job) continue;

      await prisma.$transaction([
        prisma.job.update({ where: { id: jobId }, data: { salesRepId } }),
        prisma.activityLog.create({
          data: {
            leadId: job.leadId,
            activityType: "ASSIGNMENT_CHANGE",
            title: `Job bulk assigned to ${assignee.firstName} ${assignee.lastName}`,
            description: reason ?? undefined,
            createdByUserId: session.user.id,
          },
        }),
      ]);

      await recordAudit({
        actorUserId: session.user.id,
        entityType: "Job",
        entityId: jobId,
        action: "assign",
        before: { salesRepId: job.salesRepId },
        after: { salesRepId, bulk: true, reason: reason ?? null },
      });

      updated++;
    } catch (err) {
      logger.exception(err, { where: "jobs.bulk-assign", jobId });
    }
  }

  return NextResponse.json({ updated, requested: jobIds.length });
}
