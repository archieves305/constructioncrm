import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { ensureDailyLog, getDailyLog } from "@/lib/labor/log-service";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string; date: string }> };

export async function POST(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const log = await ensureDailyLog(jobId, date, ctx.session.user.id);
  if (log.status !== "DRAFT") {
    return NextResponse.json(
      { error: `Log is already ${log.status.toLowerCase()}` },
      { status: 409 },
    );
  }

  await prisma.dailyLog.update({
    where: { id: log.id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      submittedByUserId: ctx.session.user.id,
      returnNote: null,
    },
  });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: log.id,
    action: "log_submit",
    after: { jobId, date },
  });

  const fresh = await getDailyLog(jobId, date);
  return NextResponse.json(serializeDailyLog(fresh!, ctx.session.user.role));
}
