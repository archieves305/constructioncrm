import { prisma } from "@/lib/db/prisma";
import type {
  PermitStatus,
  PermitInspectionResult,
} from "@/generated/prisma/enums";

export const PERMIT_EVENTS = [
  "PERMIT_CREATED",
  "PERMIT_STATUS_APPLIED",
  "PERMIT_STATUS_IN_PROGRESS",
  "PERMIT_STATUS_ISSUED",
  "PERMIT_STATUS_FINAL",
  "PERMIT_STATUS_EXPIRED",
  "PERMIT_STATUS_DENIED",
  "PERMIT_AGING_7D",
  "PERMIT_AGING_14D",
  "PERMIT_EXPIRING_30D",
] as const;

export const INSPECTION_EVENTS = [
  "INSPECTION_SCHEDULED",
  "INSPECTION_REMINDER_24H",
  "INSPECTION_PASSED",
  "INSPECTION_FAILED",
  "INSPECTION_CONDITIONAL",
  "INSPECTION_CANCELLED",
] as const;

export type PermitEvent = (typeof PERMIT_EVENTS)[number];
export type InspectionEvent = (typeof INSPECTION_EVENTS)[number];

export function resultEventName(
  result: PermitInspectionResult | string,
): InspectionEvent | null {
  switch (result) {
    case "PASS":
      return "INSPECTION_PASSED";
    case "FAIL":
      return "INSPECTION_FAILED";
    case "CONDITIONAL":
      return "INSPECTION_CONDITIONAL";
    case "CANCELLED":
      return "INSPECTION_CANCELLED";
    default:
      return null;
  }
}

export function statusEventName(status: PermitStatus | string): PermitEvent | null {
  switch (status) {
    case "APPLIED":
      return "PERMIT_STATUS_APPLIED";
    case "IN_PROGRESS":
      return "PERMIT_STATUS_IN_PROGRESS";
    case "ISSUED":
      return "PERMIT_STATUS_ISSUED";
    case "FINAL":
      return "PERMIT_STATUS_FINAL";
    case "EXPIRED":
      return "PERMIT_STATUS_EXPIRED";
    case "DENIED":
      return "PERMIT_STATUS_DENIED";
    default:
      return null;
  }
}

/**
 * Emits a permit-scoped follow-up event. Resolves the permit → job → leadId
 * and creates one FollowUpExecution per active rule matching this trigger,
 * tagged with the permit so the processor can render permit.* template
 * variables. Returns the number of executions queued.
 *
 * Optionally skips firing if the same rule has already produced a non-CANCELLED
 * execution for this permit within `dedupeWindowDays`. Used by the aging cron
 * so a daily run doesn't refire every threshold every day.
 */
export async function emitPermitEvent(
  event: PermitEvent,
  permitId: string,
  opts: { dedupeWindowDays?: number } = {},
): Promise<number> {
  const permit = await prisma.jobPermit.findUnique({
    where: { id: permitId },
    select: { id: true, job: { select: { leadId: true } } },
  });
  if (!permit?.job?.leadId) return 0;

  const rules = await prisma.followUpRule.findMany({
    where: { triggerEvent: event, isActive: true },
    select: { id: true, delayMinutes: true },
  });
  if (rules.length === 0) return 0;

  let dedupeRuleIds = new Set<string>();
  if (opts.dedupeWindowDays && opts.dedupeWindowDays > 0) {
    const since = new Date(Date.now() - opts.dedupeWindowDays * 86400000);
    const existing = await prisma.followUpExecution.findMany({
      where: {
        permitId,
        ruleId: { in: rules.map((r) => r.id) },
        status: { in: ["PENDING", "SENT"] },
        createdAt: { gte: since },
      },
      select: { ruleId: true },
    });
    dedupeRuleIds = new Set(existing.map((e) => e.ruleId));
  }

  const now = Date.now();
  const fresh = rules.filter((r) => !dedupeRuleIds.has(r.id));
  if (fresh.length === 0) return 0;

  await prisma.followUpExecution.createMany({
    data: fresh.map((r) => ({
      ruleId: r.id,
      leadId: permit.job.leadId,
      permitId: permit.id,
      scheduledAt: new Date(now + r.delayMinutes * 60 * 1000),
    })),
  });
  return fresh.length;
}

/**
 * Inspection-scoped variant. Resolves the inspection → permit → job → lead
 * and writes FollowUpExecution rows tagged with both the inspection and the
 * permit so templates can render permit.* AND inspection.* variables.
 *
 * Dedupes by inspection+rule within `dedupeWindowDays` so the T-24h reminder
 * cron can run hourly without refiring.
 */
export async function emitInspectionEvent(
  event: InspectionEvent,
  inspectionId: string,
  opts: { dedupeWindowDays?: number } = {},
): Promise<number> {
  const insp = await prisma.jobPermitInspection.findUnique({
    where: { id: inspectionId },
    select: {
      id: true,
      permitId: true,
      permit: { select: { job: { select: { leadId: true } } } },
    },
  });
  if (!insp?.permit?.job?.leadId) return 0;

  const rules = await prisma.followUpRule.findMany({
    where: { triggerEvent: event, isActive: true },
    select: { id: true, delayMinutes: true },
  });
  if (rules.length === 0) return 0;

  let dedupeRuleIds = new Set<string>();
  if (opts.dedupeWindowDays && opts.dedupeWindowDays > 0) {
    const since = new Date(Date.now() - opts.dedupeWindowDays * 86400000);
    const existing = await prisma.followUpExecution.findMany({
      where: {
        inspectionId,
        ruleId: { in: rules.map((r) => r.id) },
        status: { in: ["PENDING", "SENT"] },
        createdAt: { gte: since },
      },
      select: { ruleId: true },
    });
    dedupeRuleIds = new Set(existing.map((e) => e.ruleId));
  }

  const now = Date.now();
  const fresh = rules.filter((r) => !dedupeRuleIds.has(r.id));
  if (fresh.length === 0) return 0;

  await prisma.followUpExecution.createMany({
    data: fresh.map((r) => ({
      ruleId: r.id,
      leadId: insp.permit.job.leadId,
      permitId: insp.permitId,
      inspectionId: insp.id,
      scheduledAt: new Date(now + r.delayMinutes * 60 * 1000),
    })),
  });
  return fresh.length;
}
