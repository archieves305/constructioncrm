import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import type { FollowUpThresholds } from "./follow-ups";

/**
 * The Business Development settings singleton (id "default"), created on
 * first read so a fresh install and prod behave the same.
 */
export const DEFAULT_MARKETS = ["Miami-Dade", "Broward", "Palm Beach", "St. Lucie", "Orange", "Brevard", "Hillsborough", "Pinellas", "Martin", "Hendry", "Lee", "Collier"];
/** The checklist a new qualification starts with (CompanyDocumentType keys). */
export const DEFAULT_REQUIREMENT_KEYS = ["w9", "gl_coi", "wc_coi", "auto_coi", "contractor_license", "safety_program", "emr_letter", "references"];

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
  vaultOwnerUserId: true,
  defaultRequirementTypeKeys: true,
  scoreWeights: true,
  scoreWeightsVersion: true,
  ourTradeIds: true,
  homeCounties: true,
  adjacentCounties: true,
  typicalRange: true,
  bondingCapacity: true,
  healthWeights: true,
  healthWeightsVersion: true,
  preferredMinAwards: true,
  preferredMinMargin: true,
  updatedAt: true,
  defaultOwner: { select: { id: true, firstName: true, lastName: true, isActive: true } },
  vaultOwner: { select: { id: true, firstName: true, lastName: true, isActive: true } },
} as const;

export type PartnerSettingsRow = NonNullable<Awaited<ReturnType<typeof readSettings>>>;

async function readSettings() {
  return prisma.partnerSettings.findUnique({ where: { id: "default" }, select: SELECT });
}

export async function getPartnerSettings() {
  const existing = await readSettings();
  if (existing) return existing;
  await prisma.partnerSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default", markets: DEFAULT_MARKETS, defaultRequirementTypeKeys: DEFAULT_REQUIREMENT_KEYS } });
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
  vaultOwnerUserId: string | null;
  defaultRequirementTypeKeys: string[];
  scoreWeights: unknown;
  ourTradeIds: string[];
  homeCounties: string[];
  adjacentCounties: string[];
  typicalRange: unknown;
  bondingCapacity: number | null;
  healthWeights: unknown;
  preferredMinAwards: number;
  preferredMinMargin: number;
}>;

export async function updatePartnerSettings(patch: PartnerSettingsPatch, actorUserId: string) {
  const before = await getPartnerSettings();
  const data: PartnerSettingsPatch = { ...patch };
  if (data.markets) data.markets = Array.from(new Set(data.markets.map((m) => m.trim()).filter(Boolean)));
  if (data.defaultRequirementTypeKeys) data.defaultRequirementTypeKeys = Array.from(new Set(data.defaultRequirementTypeKeys.map((k) => k.trim()).filter(Boolean)));
  // Edited weights get a new version so every stored decision keeps its own.
  // Postgres stores JSON with its own key order, so compare canonically.
  const weightsChanged = data.scoreWeights !== undefined && canonical(data.scoreWeights) !== canonical(before.scoreWeights);
  const healthChanged = data.healthWeights !== undefined && canonical(data.healthWeights) !== canonical(before.healthWeights);
  const after = await prisma.partnerSettings.update({
    where: { id: "default" },
    data: {
      ...(data as Prisma.PartnerSettingsUpdateInput),
      // A JSON column is cleared with DbNull, not null.
      ...(data.scoreWeights === null ? { scoreWeights: Prisma.DbNull } : {}),
      ...(data.typicalRange === null ? { typicalRange: Prisma.DbNull } : {}),
      ...(data.healthWeights === null ? { healthWeights: Prisma.DbNull } : {}),
      ...(healthChanged ? { healthWeightsVersion: { increment: 1 } } : {}),
      ...(weightsChanged ? { scoreWeightsVersion: { increment: 1 } } : {}),
    },
    select: SELECT,
  });
  await recordAudit({ actorUserId, entityType: "PartnerSettings", entityId: "default", action: "update", before: pick(before, patch), after: pick(after, patch) });
  return after;
}

function pick(row: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, row[k]]));
}

/** JSON with object keys sorted at every level, for equality checks. */
export function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => (Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])])) : x);
  return JSON.stringify(sort(v ?? null));
}
