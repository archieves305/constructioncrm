import type { Prisma } from "@/generated/prisma/client";
import { addDays, fromDbDate, weekStartOf } from "./dates";
import {
  allocateWeeklyOvertime,
  computeEntryCost,
  computeShiftMinutes,
} from "./hours";
import type { LaborSettingsValues } from "./settings";

type Tx = Prisma.TransactionClient;

// A worker's weekly OT allocation spans ALL jobs (true payroll semantics),
// so editing Friday's sheet on job B can re-split Monday's hours on job A.
// Entries on APPROVED logs are frozen: if a recompute would change one, the
// whole save fails with the locked dates so an admin can reopen first.
export class ApprovedEntriesLockedError extends Error {
  lockedDates: string[];
  constructor(lockedDates: string[]) {
    super(
      `Weekly overtime recompute would modify hours on approved logs: ${lockedDates.join(", ")}`,
    );
    this.name = "ApprovedEntriesLockedError";
    this.lockedDates = lockedDates;
  }
}

// Entries covered by a payroll payment are money already out the door: a
// recompute that would change their hours/cost fails loudly so an admin
// undoes the payment first (which also removes the posted job expenses).
export class PaidEntriesLockedError extends Error {
  lockedDates: string[];
  constructor(lockedDates: string[]) {
    super(
      `These days were already paid out in payroll: ${lockedDates.join(", ")}`,
    );
    this.name = "PaidEntriesLockedError";
    this.lockedDates = lockedDates;
  }
}

export type WeekTouch = { personnelId: string; workDate: string };

export type RecomputeOptions = {
  /**
   * Let the recompute rewrite entries sitting on APPROVED logs instead of
   * throwing. Set only for callers the actor is allowed to amend approved
   * days (canAmendApprovedLog) — the OT split spans every job in the week,
   * so an amendment on one job legitimately re-splits approved days on
   * another. The paid-entries lock is NOT affected by this.
   */
  allowApprovedEdits?: boolean;
};

/**
 * Re-run weekly OT allocation for every (worker, week) named by `touches`,
 * rewrite changed entries' hours/costs, and mirror BudgetAllocations
 * (1:1 per entry, amount = totalCost) for every recomputed entry.
 * Must run inside the same transaction as the sheet write.
 */
export async function recomputeWorkerWeeks(
  tx: Tx,
  touches: WeekTouch[],
  settings: LaborSettingsValues,
  options: RecomputeOptions = {},
): Promise<void> {
  const weekKeys = new Map<string, { personnelId: string; weekStart: string }>();
  for (const t of touches) {
    const weekStart = weekStartOf(t.workDate, settings.weekStartsOn);
    weekKeys.set(`${t.personnelId}|${weekStart}`, {
      personnelId: t.personnelId,
      weekStart,
    });
  }

  for (const { personnelId, weekStart } of weekKeys.values()) {
    const weekEnd = addDays(weekStart, 7);
    const entries = await tx.dailyLaborEntry.findMany({
      where: {
        personnelId,
        workDate: {
          gte: new Date(`${weekStart}T00:00:00Z`),
          lt: new Date(`${weekEnd}T00:00:00Z`),
        },
      },
      select: {
        id: true,
        workDate: true,
        startMinutes: true,
        endMinutes: true,
        breakMinutes: true,
        isAbsent: true,
        regularHours: true,
        otHours: true,
        totalHours: true,
        regularRate: true,
        otRate: true,
        totalCost: true,
        budgetLineId: true,
        payrollPaymentId: true,
        dailyLog: { select: { status: true } },
      },
    });
    if (entries.length === 0) continue;

    const allocation = allocateWeeklyOvertime(
      entries.map((e) => ({
        id: e.id,
        workDate: fromDbDate(e.workDate),
        minutes: e.isAbsent
          ? 0
          : computeShiftMinutes({
              startMinutes: e.startMinutes,
              endMinutes: e.endMinutes,
              breakMinutes: e.breakMinutes,
            }),
      })),
      settings,
    );

    const locked: string[] = [];
    const paidLocked: string[] = [];
    const updates: {
      id: string;
      regularHours: number;
      otHours: number;
      totalHours: number;
      totalCost: number;
    }[] = [];

    for (const e of entries) {
      const hours = allocation.get(e.id)!;
      const totalCost = computeEntryCost({
        regularHours: hours.regularHours,
        otHours: hours.otHours,
        regularRate: Number(e.regularRate),
        otRate: Number(e.otRate),
      });
      const changed =
        Number(e.regularHours) !== hours.regularHours ||
        Number(e.otHours) !== hours.otHours ||
        Number(e.totalHours) !== hours.totalHours ||
        Number(e.totalCost) !== totalCost;
      if (!changed) continue;
      if (e.payrollPaymentId) {
        paidLocked.push(fromDbDate(e.workDate));
        continue;
      }
      if (e.dailyLog.status === "APPROVED" && !options.allowApprovedEdits) {
        locked.push(fromDbDate(e.workDate));
        continue;
      }
      updates.push({ id: e.id, ...hours, totalCost });
    }

    if (paidLocked.length > 0) {
      throw new PaidEntriesLockedError([...new Set(paidLocked)].sort());
    }
    if (locked.length > 0) {
      throw new ApprovedEntriesLockedError([...new Set(locked)].sort());
    }

    for (const u of updates) {
      await tx.dailyLaborEntry.update({
        where: { id: u.id },
        data: {
          regularHours: u.regularHours,
          otHours: u.otHours,
          totalHours: u.totalHours,
          totalCost: u.totalCost,
        },
      });
    }

    // Mirror budget allocations for the whole week (covers new entries,
    // changed costs, and budget-line changes/removals).
    const fresh = await tx.dailyLaborEntry.findMany({
      where: { id: { in: entries.map((e) => e.id) } },
      select: { id: true, budgetLineId: true, totalCost: true },
    });
    for (const e of fresh) {
      if (e.budgetLineId) {
        await tx.budgetAllocation.upsert({
          where: { dailyLaborEntryId: e.id },
          create: {
            budgetLineId: e.budgetLineId,
            dailyLaborEntryId: e.id,
            amount: e.totalCost,
          },
          update: { budgetLineId: e.budgetLineId, amount: e.totalCost },
        });
      } else {
        await tx.budgetAllocation.deleteMany({
          where: { dailyLaborEntryId: e.id },
        });
      }
    }
  }
}
