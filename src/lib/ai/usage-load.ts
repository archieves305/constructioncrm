import { prisma } from "@/lib/db/prisma";
import { aiCaps, defaultModel, isAiConfigured } from "./client";
import { monthStart } from "./policy";
import { lastMonthKeys, summarizeUsage, type UsageSummary } from "./usage";

const MONTHS_BACK = 6;

export type AiUsageReport = UsageSummary & {
  configured: boolean;
  model: string;
  caps: { maxSubject: number; maxMonth: number };
};

export async function loadAiUsage(now: Date = new Date()): Promise<AiUsageReport> {
  const first = lastMonthKeys(now, MONTHS_BACK)[0];
  const since = monthStart(new Date(`${first}-15T12:00:00Z`));
  const rows = await prisma.aiCall.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, createdAt: true, subjectType: true, subjectId: true, purpose: true, model: true, status: true, costUsd: true, error: true },
  });
  return { configured: isAiConfigured(), model: defaultModel(), caps: aiCaps(), ...summarizeUsage(rows, now, MONTHS_BACK) };
}
