import { prisma } from "@/lib/db/prisma";

export const LEAD_EVENTS = [
  "LEAD_CREATED",
  "LEAD_STAGE_CHANGED",
  "LEAD_ASSIGNED",
] as const;
export type LeadEvent = (typeof LEAD_EVENTS)[number];

type EmitContext = {
  // For LEAD_STAGE_CHANGED: the stage the lead just entered. Used to
  // filter rules with a targetStageId — a rule with no targetStageId
  // still matches any stage change (legacy behavior).
  targetStageId?: string;
};

export async function emitLeadEvent(
  event: LeadEvent,
  leadId: string,
  context: EmitContext = {},
): Promise<number> {
  const where =
    event === "LEAD_STAGE_CHANGED" && context.targetStageId
      ? {
          triggerEvent: event,
          isActive: true,
          OR: [
            { targetStageId: null },
            { targetStageId: context.targetStageId },
          ],
        }
      : { triggerEvent: event, isActive: true };

  const rules = await prisma.followUpRule.findMany({
    where,
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
