import { NextRequest, NextResponse } from "next/server";
import { badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { laborSheetSchema } from "@/lib/validation/labor";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import {
  canAmendApprovedLog,
  canEditLogAtStatus,
  canEditPayRates,
  getFieldGrants,
} from "@/lib/labor/permissions";
import { recordAudit } from "@/lib/audit/record";
import { serializeDailyLog } from "@/lib/labor/serialize";
import {
  LogConflictError,
  ensureDailyLog,
  saveLaborSheet,
} from "@/lib/labor/log-service";
import {
  ApprovedEntriesLockedError,
  PaidEntriesLockedError,
} from "@/lib/labor/recompute";
import { logger } from "@/lib/logger";

type Context = { params: Promise<{ id: string; date: string }> };

// Full-sheet replace: the payload is the complete labor sheet for the day.
// Entries are upserted by client-generated cuid and absent rows are deleted,
// so an offline retry of the same payload is a no-op.
export async function PUT(request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, laborSheetSchema);
  if (!v.ok) return v.response;

  const log = await ensureDailyLog(jobId, date, ctx.session.user.id);
  if (!canEditLogAtStatus(log.status, ctx.session.user.role, ctx.access)) {
    return NextResponse.json(
      { error: `Log is ${log.status.toLowerCase()} and can no longer be edited` },
      { status: 409 },
    );
  }

  const grants = await getFieldGrants(ctx.session.user.id);
  const canOverrideRates = canEditPayRates(ctx.session.user.role, grants);
  if (!canOverrideRates && v.data.entries.some((e) => e.regularRate != null)) {
    // Silently ignoring would surprise the caller; be explicit.
    return NextResponse.json(
      { error: "Rate overrides require the pay-rate permission" },
      { status: 403 },
    );
  }

  const amendingApproved =
    log.status === "APPROVED" && canAmendApprovedLog(ctx.session.user.role);

  try {
    const saved = await saveLaborSheet({
      jobId,
      date,
      viewer: { id: ctx.session.user.id, role: ctx.session.user.role },
      entries: v.data.entries,
      baseUpdatedAt: v.data.baseUpdatedAt,
      canOverrideRates,
      canAmendApproved: amendingApproved,
    });

    // An approved day's hours are what payroll pays on, so changing them
    // after the fact leaves a trail even though the status never moves.
    if (amendingApproved) {
      await recordAudit({
        actorUserId: ctx.session.user.id,
        entityType: "DailyLog",
        entityId: log.id,
        action: "log_amend",
        before: {
          totalHours: log.laborEntries.reduce((s, e) => s + Number(e.totalHours), 0),
          entries: log.laborEntries.length,
        },
        after: {
          section: "labor",
          totalHours: saved.laborEntries.reduce((s, e) => s + Number(e.totalHours), 0),
          entries: saved.laborEntries.length,
        },
      });
    }

    return NextResponse.json(serializeDailyLog(saved, ctx.session.user.role));
  } catch (err) {
    if (err instanceof LogConflictError) {
      return NextResponse.json(
        { error: "Log was modified elsewhere", serverUpdatedAt: err.serverUpdatedAt },
        { status: 409 },
      );
    }
    if (err instanceof PaidEntriesLockedError) {
      return NextResponse.json(
        {
          error:
            "These hours were already paid out in payroll. An admin must undo that payment before they can change.",
          lockedDates: err.lockedDates,
        },
        { status: 409 },
      );
    }
    if (err instanceof ApprovedEntriesLockedError) {
      return NextResponse.json(
        {
          error:
            "This change would re-split overtime on approved logs. Ask an admin or accounting to make the change.",
          lockedDates: err.lockedDates,
        },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message.startsWith("Unknown personnel")) {
      return badRequest(err.message);
    }
    logger.exception(err, { where: "daily-logs.labor.put", jobId, date });
    return NextResponse.json({ error: "Failed to save labor sheet" }, { status: 500 });
  }
}
