import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import type { FollowUpThresholds } from "./follow-ups";

/**
 * The Business Development settings singleton (id "default"), created on
 * first read so a fresh install and prod behave the same.
 */
export const DEFAULT_MARKETS = ["Miami-Dade", "Broward", "Palm Beach", "St. Lucie", "Orange", "Brevard", "Hillsborough", "Pinellas", "Martin", "Hendry", "Lee", "Collier"];

const SELECT = {
  id: true,
  newTargetDays: true,
  noResponseDays: true,
  qualSubmittedDays: true,
  prequalNoBidDays: true,
  activeQuietDays: true,
  dormantAfterDays: true,
  defaultOwnerUserId: true,
  markets: true,
  updatedAt: true,
  defaultOwner: { select: { id: true, firstName: true, lastName: true, isActive: true } },
} as const;

export type PartnerSettingsRow = NonNullable<Awaited<ReturnType<typeof readSettings>>>;

async function readSettings() {
  return prisma.partnerSettings.findUnique({ where: { id: "default" }, select: SELECT });
}

export async function getPartnerSettings() {
  const existing = await readSettings();
  if (existing) return existing;
  await prisma.partnerSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default", markets: DEFAULT_MARKETS } });
  return (await readSettings())!;
}

export function thresholdsOf(s: FollowUpThresholds): FollowUpThresholds {
  return { newTargetDays: s.newTargetDays, noResponseDays: s.noResponseDays, qualSubmittedDays: s.qualSubmittedDays, prequalNoBidDays: s.prequalNoBidDays, activeQuietDays: s.activeQuietDays };
}

export type PartnerSettingsPatch = Partial<{
  newTargetDays: number;
  noResponseDays: number;
  qualSubmittedDays: number;
  prequalNoBidDays: number;
  activeQuietDays: number;
  dormantAfterDays: number;
  defaultOwnerUserId: string | null;
  markets: string[];
}>;

export async function updatePartnerSettings(patch: PartnerSettingsPatch, actorUserId: string) {
  const before = await getPartnerSettings();
  const data: PartnerSettingsPatch = { ...patch };
  if (data.markets) data.markets = Array.from(new Set(data.markets.map((m) => m.trim()).filter(Boolean)));
  const after = await prisma.partnerSettings.update({ where: { id: "default" }, data, select: SELECT });
  await recordAudit({ actorUserId, entityType: "PartnerSettings", entityId: "default", action: "update", before: pick(before, patch), after: pick(after, patch) });
  return after;
}

function pick(row: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, row[k]]));
}
