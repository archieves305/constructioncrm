import { prisma } from "@/lib/db/prisma";
import { createBankCheck } from "./checks";
import {
  BuildiumError,
  BuildiumNotConfiguredError,
  isBuildiumConfigured,
} from "./client";

export type SyncResult =
  | { ok: true; billId: string; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string; status?: number };

export type SyncOptions = {
  bankAccountId: number;
  vendorId: number;
};

export async function syncExpenseToBuildium(
  expenseId: string,
  options: SyncOptions,
): Promise<SyncResult> {
  if (!isBuildiumConfigured()) {
    return { ok: false, error: new BuildiumNotConfiguredError().message };
  }
  if (!options.bankAccountId) {
    return { ok: false, error: "bankAccountId is required" };
  }
  if (!options.vendorId) {
    return { ok: false, error: "vendorId is required" };
  }

  const expense = await prisma.jobExpense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      amount: true,
      vendor: true,
      description: true,
      type: true,
      incurredDate: true,
      buildiumBillId: true,
      job: {
        select: {
          jobNumber: true,
          isRentalTurnover: true,
          buildiumPropertyId: true,
          buildiumUnitId: true,
        },
      },
    },
  });

  if (!expense) {
    return { ok: false, error: "Expense not found" };
  }

  if (expense.buildiumBillId) {
    return {
      ok: true,
      skipped: true,
      reason: `Already posted as Buildium transaction ${expense.buildiumBillId}`,
    };
  }

  if (!expense.job.isRentalTurnover) {
    return {
      ok: false,
      error: "Job is not marked as a rental turnover — cannot sync.",
    };
  }

  if (!expense.job.buildiumPropertyId) {
    return {
      ok: false,
      error: "Job is not linked to a Buildium property.",
    };
  }

  try {
    const memo =
      [
        expense.job.jobNumber,
        expense.type,
        expense.vendor || undefined,
        expense.description || undefined,
      ]
        .filter(Boolean)
        .join(" · ") || expense.job.jobNumber;

    const check = await createBankCheck({
      bankAccountId: options.bankAccountId,
      vendorId: options.vendorId,
      buildiumPropertyId: expense.job.buildiumPropertyId,
      buildiumUnitId: expense.job.buildiumUnitId,
      amount: Number(expense.amount),
      incurredDate: expense.incurredDate,
      memo,
    });

    await prisma.jobExpense.update({
      where: { id: expense.id },
      data: {
        buildiumBillId: String(check.Id),
        buildiumSyncStatus: "SYNCED",
        buildiumSyncError: null,
        buildiumSyncedAt: new Date(),
      },
    });

    return { ok: true, billId: String(check.Id) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    const status = e instanceof BuildiumError ? e.status : undefined;
    await prisma.jobExpense.update({
      where: { id: expense.id },
      data: {
        buildiumSyncStatus: "FAILED",
        buildiumSyncError: message,
      },
    });
    return { ok: false, error: message, status };
  }
}
