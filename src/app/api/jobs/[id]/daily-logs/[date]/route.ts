import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { dailyLogUpsertSchema } from "@/lib/validation/labor";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import {
  canAmendApprovedLog,
  canDeleteLog,
  canEditLogAtStatus,
} from "@/lib/labor/permissions";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { ensureDailyLog, getDailyLog } from "@/lib/labor/log-service";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string; date: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const log = await getDailyLog(jobId, date);
  if (!log) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serializeDailyLog(log, ctx.session.user.role));
}

// Idempotent upsert of the log header/narrative for (job, date). Creates the
// DRAFT shell when missing, so an offline retry of the same payload is safe.
export async function PUT(request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, dailyLogUpsertSchema);
  if (!v.ok) return v.response;
  const { baseUpdatedAt, ...fields } = v.data;

  const log = await ensureDailyLog(jobId, date, ctx.session.user.id);

  if (!canEditLogAtStatus(log.status, ctx.session.user.role, ctx.access)) {
    return NextResponse.json(
      { error: `Log is ${log.status.toLowerCase()} and can no longer be edited` },
      { status: 409 },
    );
  }

  if (baseUpdatedAt !== undefined) {
    const base = new Date(baseUpdatedAt).getTime();
    if (!Number.isNaN(base) && log.updatedAt.getTime() > base) {
      return NextResponse.json(
        { error: "Log was modified elsewhere", serverUpdatedAt: log.updatedAt.toISOString() },
        { status: 409 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data[key] = value;
  }

  const updated = await prisma.dailyLog.update({
    where: { id: log.id },
    data,
  });

  // Approved days are already out the door (PDF'd, emailed, payroll-counted),
  // so record who changed the report afterwards.
  if (log.status === "APPROVED" && canAmendApprovedLog(ctx.session.user.role)) {
    await recordAudit({
      actorUserId: ctx.session.user.id,
      entityType: "DailyLog",
      entityId: log.id,
      action: "log_amend",
      after: { section: "narrative", fields: Object.keys(data) },
    });
  }

  const full = await getDailyLog(jobId, date);
  return NextResponse.json(
    serializeDailyLog({ ...full!, ...updated }, ctx.session.user.role),
  );
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const log = await getDailyLog(jobId, date);
  if (!log) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canDeleteLog(log.status, ctx.session.user.role, ctx.access)) {
    return forbidden();
  }
  // Deleting entries that a payroll payment already covered would orphan the
  // posted expenses; undo the payment first.
  const paidEntries = await prisma.dailyLaborEntry.count({
    where: { dailyLogId: log.id, payrollPaymentId: { not: null } },
  });
  if (paidEntries > 0) {
    return NextResponse.json(
      { error: "This day's hours were already paid out in payroll. Undo that payment first." },
      { status: 409 },
    );
  }

  await prisma.dailyLog.delete({ where: { id: log.id } });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: log.id,
    action: "delete",
    before: { jobId, date, status: log.status, entries: log.laborEntries.length },
  });

  return NextResponse.json({ ok: true });
}
