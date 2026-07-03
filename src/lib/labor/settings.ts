import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { OtSettings } from "./hours";

export type LaborSettingsValues = OtSettings & {
  weekStartsOn: number;
  bookkeeperEmail: string | null;
};

export const DEFAULT_LABOR_SETTINGS: LaborSettingsValues = {
  otWeeklyThreshold: 40,
  otDailyThreshold: null,
  otMultiplier: 1.5,
  weekStartsOn: 1, // Monday
  bookkeeperEmail: null,
};

type Client = Prisma.TransactionClient | typeof prisma;

/** Load the OT-policy singleton as plain numbers; defaults when unset. */
export async function getLaborSettings(db: Client = prisma): Promise<LaborSettingsValues> {
  const row = await db.laborSettings.findFirst();
  if (!row) return DEFAULT_LABOR_SETTINGS;
  return {
    otWeeklyThreshold: Number(row.otWeeklyThreshold),
    otDailyThreshold: row.otDailyThreshold == null ? null : Number(row.otDailyThreshold),
    otMultiplier: Number(row.otMultiplier),
    weekStartsOn: row.weekStartsOn,
    bookkeeperEmail: row.bookkeeperEmail,
  };
}
