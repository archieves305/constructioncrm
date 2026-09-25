import { prisma } from "@/lib/db/prisma";
import type { CadenceSettings } from "./plan";

export type NurtureSettingsRow = Awaited<ReturnType<typeof loadNurtureSettings>>;

/** The singleton row, created with defaults on first read (like EmailBrand). */
export async function loadNurtureSettings() {
  return prisma.nurtureSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}

export function cadenceOf(row: NurtureSettingsRow): CadenceSettings {
  return {
    followUpDays: row.followUpDays,
    followUpEveryDaysAfter: row.followUpEveryDaysAfter,
    nurtureDays: row.nurtureDays,
    nurtureEveryDaysAfter: row.nurtureEveryDaysAfter,
    nurtureMonthlyOffsetDays: row.nurtureMonthlyOffsetDays,
    minGapHours: row.minGapHours,
    sendWindowStartHour: row.sendWindowStartHour,
    sendWindowEndHour: row.sendWindowEndHour,
    timeZone: row.timeZone,
    weekdaysOnly: row.weekdaysOnly,
    personalTouchSkipDays: row.personalTouchSkipDays,
    repPromptAfterDays: row.repPromptAfterDays,
    excludedStageIds: row.excludedStageIds,
  };
}
