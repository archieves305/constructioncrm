import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { newEntryId } from "@/lib/labor/ids";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { canEditLogAtStatus } from "@/lib/labor/permissions";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { ensureDailyLog, saveLaborSheet } from "@/lib/labor/log-service";
import { toDbDate, fromDbDate } from "@/lib/labor/dates";

type Context = { params: Promise<{ id: string; date: string }> };

// "Copy yesterday's crew": pull the roster (workers, times, trades, areas,
// cost codes, budget lines — not flags/notes) from the job's most recent
// prior log into this day's DRAFT sheet. Rates re-snapshot at current values.
export async function POST(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const log = await ensureDailyLog(jobId, date, ctx.session.user.id);
  if (!canEditLogAtStatus(log.status, ctx.session.user.role, ctx.access)) {
    return NextResponse.json(
      { error: `Log is ${log.status.toLowerCase()} and can no longer be edited` },
      { status: 409 },
    );
  }

  const previous = await prisma.dailyLog.findFirst({
    where: { jobId, logDate: { lt: toDbDate(date) } },
    orderBy: { logDate: "desc" },
    include: {
      laborEntries: {
        where: { isAbsent: false },
        select: {
          personnelId: true,
          trade: true,
          jobAreaId: true,
          workArea: true,
          startMinutes: true,
          endMinutes: true,
          breakMinutes: true,
          costCodeId: true,
          phase: true,
          budgetLineId: true,
          personnel: { select: { isActive: true, deletedAt: true } },
        },
      },
    },
  });
  if (!previous || previous.laborEntries.length === 0) {
    return NextResponse.json(
      { error: "No previous crew found for this job" },
      { status: 404 },
    );
  }

  // Merge: keep any workers already on today's sheet; add the rest.
  const alreadyOn = new Set(log.laborEntries.map((e) => e.personnelId));
  const toAdd = previous.laborEntries.filter(
    (e) => !alreadyOn.has(e.personnelId) && e.personnel.isActive && !e.personnel.deletedAt,
  );

  const entries = [
    ...log.laborEntries.map((e) => ({
      id: e.id,
      personnelId: e.personnelId,
      trade: e.trade,
      jobAreaId: e.jobAreaId,
      workArea: e.workArea,
      startMinutes: e.startMinutes,
      endMinutes: e.endMinutes,
      breakMinutes: e.breakMinutes,
      costCodeId: e.costCodeId,
      phase: e.phase,
      budgetLineId: e.budgetLineId,
      isAbsent: e.isAbsent,
      isLate: e.isLate,
      leftEarly: e.leftEarly,
      absenceReason: e.absenceReason,
      notes: e.notes,
    })),
    ...toAdd.map((e) => ({
      id: newEntryId(),
      personnelId: e.personnelId,
      trade: e.trade,
      jobAreaId: e.jobAreaId,
      workArea: e.workArea,
      startMinutes: e.startMinutes,
      endMinutes: e.endMinutes,
      breakMinutes: e.breakMinutes,
      costCodeId: e.costCodeId,
      phase: e.phase,
      budgetLineId: e.budgetLineId,
      isAbsent: false,
      isLate: false,
      leftEarly: false,
      absenceReason: null,
      notes: null,
    })),
  ];

  const saved = await saveLaborSheet({
    jobId,
    date,
    viewer: { id: ctx.session.user.id, role: ctx.session.user.role },
    entries,
    canOverrideRates: false,
  });

  return NextResponse.json({
    copiedFrom: fromDbDate(previous.logDate),
    added: toAdd.length,
    log: serializeDailyLog(saved, ctx.session.user.role),
  });
}
