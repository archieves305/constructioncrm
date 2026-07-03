import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/auth/helpers";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { canApproveLog } from "@/lib/labor/permissions";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { getDailyLog } from "@/lib/labor/log-service";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string; date: string }> };

// Approval freezes the log: hours and costs become immutable until an ADMIN
// reopens (the weekly-OT recompute refuses to touch approved entries).
export async function POST(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;
  if (!canApproveLog(ctx.session.user.role)) return forbidden();

  const log = await getDailyLog(jobId, date);
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (log.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: `Only submitted logs can be approved (log is ${log.status.toLowerCase()})` },
      { status: 409 },
    );
  }

  await prisma.dailyLog.update({
    where: { id: log.id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: ctx.session.user.id,
    },
  });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: log.id,
    action: "log_approve",
    after: { jobId, date },
  });

  const fresh = await getDailyLog(jobId, date);
  return NextResponse.json(serializeDailyLog(fresh!, ctx.session.user.role));
}
