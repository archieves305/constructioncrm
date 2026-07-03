import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { returnLogSchema } from "@/lib/validation/labor";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { canReturnLog } from "@/lib/labor/permissions";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { getDailyLog } from "@/lib/labor/log-service";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string; date: string }> };

// Return a SUBMITTED log to DRAFT with a required note the foreman sees.
export async function POST(request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;
  if (!canReturnLog(ctx.session.user.role)) return forbidden();

  const v = await validateBody(request, returnLogSchema);
  if (!v.ok) return v.response;

  const log = await getDailyLog(jobId, date);
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (log.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: `Only submitted logs can be returned (log is ${log.status.toLowerCase()})` },
      { status: 409 },
    );
  }

  await prisma.dailyLog.update({
    where: { id: log.id },
    data: {
      status: "DRAFT",
      returnNote: v.data.note,
      submittedAt: null,
      submittedByUserId: null,
    },
  });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: log.id,
    action: "log_return",
    after: { jobId, date, note: v.data.note },
  });

  const fresh = await getDailyLog(jobId, date);
  return NextResponse.json(serializeDailyLog(fresh!, ctx.session.user.role));
}
