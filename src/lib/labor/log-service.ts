import { Prisma, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toDbDate, fromDbDate } from "./dates";
import { computeOtRate } from "./hours";
import { getLaborSettings } from "./settings";
import { recomputeWorkerWeeks, type WeekTouch } from "./recompute";
import type { LaborEntryInput } from "@/lib/validation/labor";

export class LogConflictError extends Error {
  serverUpdatedAt: string;
  constructor(serverUpdatedAt: string) {
    super("Log was modified elsewhere");
    this.name = "LogConflictError";
    this.serverUpdatedAt = serverUpdatedAt;
  }
}

const ENTRY_INCLUDE = {
  personnel: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      trade: true,
      // Profile defaults for pay basis / scope of work; serializeDailyLog
      // merges the job's overrides on top.
      payType: true,
      workDescription: true,
    },
  },
} satisfies Prisma.DailyLaborEntryInclude;

export const LOG_INCLUDE = {
  laborEntries: {
    include: ENTRY_INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  manager: { select: { id: true, firstName: true, lastName: true } },
  submittedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  job: {
    select: {
      personnelScopes: {
        select: { personnelId: true, payType: true, workDescription: true },
      },
    },
  },
} satisfies Prisma.DailyLogInclude;

/** Fetch the (job, date) log with entries, or null. */
export async function getDailyLog(jobId: string, date: string) {
  return prisma.dailyLog.findUnique({
    where: { jobId_logDate: { jobId, logDate: toDbDate(date) } },
    include: LOG_INCLUDE,
  });
}

/**
 * Get-or-create the DRAFT shell for (job, date). Concurrent creation is
 * resolved by catching the unique violation and re-reading.
 */
export async function ensureDailyLog(jobId: string, date: string, userId: string) {
  const existing = await getDailyLog(jobId, date);
  if (existing) return existing;
  try {
    await prisma.dailyLog.create({
      data: {
        jobId,
        logDate: toDbDate(date),
        createdByUserId: userId,
        managerUserId: userId,
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
  }
  return (await getDailyLog(jobId, date))!;
}

export type SaveSheetInput = {
  jobId: string;
  date: string;
  viewer: { id: string; role: RoleName };
  entries: LaborEntryInput[];
  baseUpdatedAt?: string;
  canOverrideRates: boolean;
  /** Viewer holds canAmendApprovedLog — lifts the approved-entries OT lock. */
  canAmendApproved?: boolean;
};

/**
 * Full-sheet replace for one (job, date): upsert every posted entry by its
 * client-generated id, delete entries missing from the payload, snapshot
 * rates, then re-run weekly OT allocation for every touched worker-week —
 * all in one transaction. Retrying the same payload is a no-op.
 *
 * Rate snapshots refresh from Personnel.hourlyRate on every DRAFT save (so
 * an office rate fix propagates to today's sheet) unless the caller sent an
 * explicit override and holds canEditPayRates.
 */
export async function saveLaborSheet(input: SaveSheetInput) {
  const { jobId, date, viewer, entries } = input;
  const log = await ensureDailyLog(jobId, date, viewer.id);

  if (input.baseUpdatedAt !== undefined) {
    const base = new Date(input.baseUpdatedAt).getTime();
    if (!Number.isNaN(base) && log.updatedAt.getTime() > base) {
      throw new LogConflictError(log.updatedAt.toISOString());
    }
  }

  const personnelIds = [...new Set(entries.map((e) => e.personnelId))];
  const people = await prisma.personnel.findMany({
    where: { id: { in: personnelIds }, deletedAt: null },
    select: { id: true, hourlyRate: true, trade: true },
  });
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const missing = personnelIds.filter((id) => !peopleById.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown personnel: ${missing.join(", ")}`);
  }

  const settings = await getLaborSettings();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.dailyLaborEntry.findMany({
      where: { dailyLogId: log.id },
      select: { id: true, personnelId: true, regularRate: true },
    });
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const postedIds = new Set(entries.map((e) => e.id));

    // Deletions: rows the client no longer has on the sheet.
    const toDelete = existing.filter((e) => !postedIds.has(e.id));
    if (toDelete.length > 0) {
      await tx.dailyLaborEntry.deleteMany({
        where: { id: { in: toDelete.map((e) => e.id) } },
      });
    }

    for (const e of entries) {
      const person = peopleById.get(e.personnelId)!;
      const prior = existingById.get(e.id);

      let regularRate: number;
      if (e.regularRate != null && input.canOverrideRates) {
        regularRate = e.regularRate;
      } else {
        regularRate = Number(person.hourlyRate ?? 0);
      }
      const otRate = computeOtRate(regularRate, settings.otMultiplier);

      const data = {
        personnelId: e.personnelId,
        trade: e.trade ?? person.trade,
        jobAreaId: e.jobAreaId ?? null,
        workArea: e.workArea ?? null,
        startMinutes: e.isAbsent ? null : (e.startMinutes ?? null),
        endMinutes: e.isAbsent ? null : (e.endMinutes ?? null),
        breakMinutes: e.isAbsent ? 0 : e.breakMinutes,
        costCodeId: e.costCodeId ?? null,
        phase: e.phase ?? null,
        budgetLineId: e.budgetLineId ?? null,
        isAbsent: e.isAbsent,
        isLate: e.isLate,
        leftEarly: e.leftEarly,
        absenceReason: e.absenceReason ?? null,
        notes: e.notes ?? null,
        regularRate,
        otRate,
      };

      if (prior) {
        await tx.dailyLaborEntry.update({ where: { id: e.id }, data });
      } else {
        await tx.dailyLaborEntry.create({
          data: {
            id: e.id,
            dailyLogId: log.id,
            jobId,
            workDate: toDbDate(date),
            createdByUserId: viewer.id,
            ...data,
          },
        });
      }
    }

    // Hours/OT/cost + budget-allocation mirroring for every touched
    // worker-week (deleted workers' weeks included).
    const touches: WeekTouch[] = [
      ...entries.map((e) => ({ personnelId: e.personnelId, workDate: date })),
      ...toDelete.map((e) => ({ personnelId: e.personnelId, workDate: date })),
    ];
    await recomputeWorkerWeeks(tx, touches, settings, {
      allowApprovedEdits: input.canAmendApproved,
    });

    // Any labor edit refreshes the log's updatedAt (autosave concurrency token).
    await tx.dailyLog.update({
      where: { id: log.id },
      data: { updatedAt: new Date() },
    });
  });

  return (await getDailyLog(jobId, date))!;
}

/** Summary shape for log lists (headcount + hours; costs added by serializer). */
export function summarizeLogList(
  logs: {
    logDate: Date;
    laborEntries: { isAbsent: boolean; personnelId: string; totalHours: unknown; totalCost: unknown }[];
    [key: string]: unknown;
  }[],
  includeCost: boolean,
) {
  return logs.map((log) => {
    const present = log.laborEntries.filter((e) => !e.isAbsent);
    const { laborEntries: _entries, logDate, ...base } = log;
    return {
      ...base,
      logDate: fromDbDate(logDate),
      workersOnsite: new Set(present.map((e) => e.personnelId)).size,
      totalHours:
        Math.round(present.reduce((s, e) => s + Number(e.totalHours), 0) * 100) / 100,
      ...(includeCost
        ? {
            totalCost:
              Math.round(present.reduce((s, e) => s + Number(e.totalCost), 0) * 100) /
              100,
          }
        : {}),
    };
  });
}
