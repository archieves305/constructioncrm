import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { pinAllDay, todayKey, type DayKey } from "@/lib/time/zone";
import { followUpPrefix, liveFollowUpKeys, planFollowUps, type FollowUpInput, type FollowUpRule, type PlannedFollowUp } from "./follow-ups";
import { bidFactsFor } from "./bids";
import { representativeQualifications } from "./qualifications";
import { getPartnerSettings, thresholdsOf } from "./settings";

/**
 * Account follow-ups as ordinary tasks: a target nobody has called, an
 * unanswered email, an active partner gone quiet. The daily cron calls
 * `raisePartnerFollowUps`; every interaction and stage write calls
 * `settlePartnerFollowUps`, so a follow-up the record has overtaken (they
 * replied, somebody met them) closes by itself.
 *
 * A task is raised once per source key, whatever became of it.
 */

const ORG_SELECT = {
  id: true,
  name: true,
  stage: true,
  createdAt: true,
  lastContactAt: true,
  ownerUserId: true,
  owner: { select: { id: true, isActive: true } },
  _count: { select: { interactions: true } },
  interactions: {
    orderBy: { occurredAt: "desc" as const },
    take: 1,
    select: { id: true, kind: true, direction: true, outcome: true, occurredAt: true, contact: { select: { firstName: true, lastName: true } } },
  },
} as const;

type OrgRow = Prisma.OrganizationGetPayload<{ select: typeof ORG_SELECT }>;

type QualFact = { status: string; submittedAt: Date | null; approvedAt: Date | null } | null;

function inputOf(o: OrgRow, qualification: QualFact, lastBidActivityAt: Date | null = null): FollowUpInput {
  const last = o.interactions[0];
  return {
    org: { id: o.id, name: o.name, stage: o.stage, createdAt: o.createdAt, lastContactAt: o.lastContactAt },
    lastInteraction: last
      ? { id: last.id, kind: last.kind, direction: last.direction, outcome: last.outcome, occurredAt: last.occurredAt, contactName: last.contact ? `${last.contact.firstName} ${last.contact.lastName}` : null }
      : null,
    interactionCount: o._count.interactions,
    qualification,
    lastBidActivityAt,
  };
}

/**
 * Who gets an account's follow-ups: its owner, else the default owner under
 * Admin → Business Development, else the oldest admin. An inactive person is
 * passed over.
 */
export async function followUpOwnerId(org: { owner: { id: string; isActive: boolean } | null }): Promise<string | null> {
  if (org.owner?.isActive) return org.owner.id;
  const s = await getPartnerSettings();
  if (s.defaultOwner?.isActive) return s.defaultOwner.id;
  const admin = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

async function raise(plan: PlannedFollowUp, orgId: string, assignee: string): Promise<boolean> {
  const seen = await prisma.task.findFirst({ where: { sourceKey: plan.sourceKey }, select: { id: true } });
  if (seen) return false;
  await createTask(
    {
      title: plan.title,
      description: plan.description,
      priority: plan.priority,
      dueAt: pinAllDay(plan.dueDay),
      allDay: true,
      assignedUserId: assignee,
      // Nobody raised it but the calendar: the owner is the only person it concerns.
      createdByUserId: assignee,
      organizationId: orgId,
      source: "auto",
      sourceKey: plan.sourceKey,
    },
    { actorUserId: null, notify: "inline" },
  );
  return true;
}

export type FollowUpRun = { organizations: number; raised: number; byRule: Record<FollowUpRule, number>; planned?: { organization: string; rule: FollowUpRule; title: string }[] };

/** Daily: raise what is due on every open account. `dryRun` reports the plan and writes nothing. */
export async function raisePartnerFollowUps(today: DayKey = todayKey(), opts: { dryRun?: boolean } = {}): Promise<FollowUpRun> {
  const out: FollowUpRun = { organizations: 0, raised: 0, byRule: { "new-target": 0, "no-response": 0, "qual-submitted": 0, "prequal-no-bids": 0, quiet: 0 }, planned: opts.dryRun ? [] : undefined };
  const settings = await getPartnerSettings();
  const t = thresholdsOf(settings);
  const orgs = await prisma.organization.findMany({ where: { isActive: true, stage: { notIn: ["DORMANT", "DO_NOT_PURSUE"] } }, select: ORG_SELECT });
  out.organizations = orgs.length;
  const [quals, bids] = await Promise.all([representativeQualifications(orgs.map((o) => o.id)), bidFactsFor(orgs.map((o) => o.id))]);
  for (const o of orgs) {
    try {
      const plans = planFollowUps(inputOf(o, quals.get(o.id) ?? null, bids.get(o.id)?.lastBidActivityAt ?? null), today, t);
      if (plans.length === 0) continue;
      if (opts.dryRun) {
        for (const p of plans) {
          const seen = await prisma.task.findFirst({ where: { sourceKey: p.sourceKey }, select: { id: true } });
          if (seen) continue;
          out.planned!.push({ organization: o.name, rule: p.rule, title: p.title });
          out.raised += 1;
          out.byRule[p.rule] += 1;
        }
        continue;
      }
      const assignee = await followUpOwnerId(o);
      if (!assignee) continue;
      for (const p of plans) {
        if (!(await raise(p, o.id, assignee))) continue;
        out.raised += 1;
        out.byRule[p.rule] += 1;
      }
    } catch (err) {
      logger.exception(err, { where: "partners.raisePartnerFollowUps", organizationId: o.id });
    }
  }
  return out;
}

/** After an interaction or stage change: close the follow-ups the record has overtaken. Never throws. */
export async function settlePartnerFollowUps(organizationId: string, actorUserId: string | null, because = "An interaction was logged on the account"): Promise<number> {
  try {
    const o = await prisma.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
    if (!o) return 0;
    const settings = await getPartnerSettings();
    const [quals, bids] = await Promise.all([representativeQualifications([o.id]), bidFactsFor([o.id])]);
    const live = liveFollowUpKeys(inputOf(o, quals.get(o.id) ?? null, bids.get(o.id)?.lastBidActivityAt ?? null), todayKey(), thresholdsOf(settings));
    const open = await prisma.task.findMany({
      where: { sourceKey: { startsWith: followUpPrefix(organizationId) }, status: { in: [...OPEN_TASK_STATUSES] } },
      select: { sourceKey: true },
    });
    let closed = 0;
    for (const key of new Set(open.map((t) => t.sourceKey as string))) {
      if (live.has(key)) continue;
      closed += (await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because })).closed;
    }
    return closed;
  } catch (err) {
    logger.exception(err, { where: "partners.settlePartnerFollowUps", organizationId });
    return 0;
  }
}
