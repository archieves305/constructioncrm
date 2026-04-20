import { prisma } from "@/lib/db/prisma";

export const LEAD_EVENTS = [
  "LEAD_CREATED",
  "LEAD_STAGE_CHANGED",
  "LEAD_ASSIGNED",
] as const;
export type LeadEvent = (typeof LEAD_EVENTS)[number];

export async function emitLeadEvent(event: LeadEvent, leadId: string): Promise<number> {
  const rules = await prisma.followUpRule.findMany({
    where: { triggerEvent: event, isActive: true },
    select: { id: true, delayMinutes: true },
  });
  if (rules.length === 0) return 0;

  const now = Date.now();
  await prisma.followUpExecution.createMany({
    data: rules.map((r) => ({
      ruleId: r.id,
      leadId,
      scheduledAt: new Date(now + r.delayMinutes * 60 * 1000),
    })),
  });
  return rules.length;
}
