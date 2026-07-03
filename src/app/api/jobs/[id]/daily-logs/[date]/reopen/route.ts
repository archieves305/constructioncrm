import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/auth/helpers";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { canReopenLog } from "@/lib/labor/permissions";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { getDailyLog } from "@/lib/labor/log-service";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string; date: string }> };

// ADMIN-only: unfreeze an APPROVED log back to DRAFT (audited).
export async function POST(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;
  if (!canReopenLog(ctx.session.user.role)) return forbidden();

  const log = await getDailyLog(jobId, date);
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (log.status !== "APPROVED") {
    return NextResponse.json(
      { error: `Only approved logs can be reopened (log is ${log.status.toLowerCase()})` },
      { status: 409 },
    );
  }

  await prisma.dailyLog.update({
    where: { id: log.id },
    data: {
      status: "DRAFT",
      approvedAt: null,
      approvedByUserId: null,
    },
  });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: log.id,
    action: "log_reopen",
    after: { jobId, date },
  });

  const fresh = await getDailyLog(jobId, date);
  return NextResponse.json(serializeDailyLog(fresh!, ctx.session.user.role));
}
