import type { InteractionDirection, InteractionKind, InteractionOutcome, PartnerStage, Priority } from "@/generated/prisma/enums";
import { dayKey, diffDayKeys, type DayKey } from "@/lib/time/zone";
import { workingDaysBetween } from "@/lib/time/working-days";

/**
 * Which follow-up tasks an account calls for today. Pure: the cron loads the
 * rows, this decides, `follow-up-run.ts` writes.
 *
 * Each rule is an ordinary task raised once per source key. The key carries
 * the rule, what it is anchored on and a period number, so a condition that
 * is still true after the previous task closed raises again once per period
 * — never while one is open, never twice for the same period. Logging an
 * interaction settles whatever the record has overtaken.
 */

export type FollowUpRule = "new-target" | "no-response" | "qual-submitted" | "prequal-no-bids" | "quiet";

export type FollowUpThresholds = {
  newTargetDays: number;
  noResponseDays: number;
  qualSubmittedDays: number;
  prequalNoBidDays: number;
  activeQuietDays: number;
};

export type FollowUpInput = {
  org: { id: string; name: string; stage: PartnerStage; createdAt: Date; lastContactAt: Date | null };
  lastInteraction: {
    id: string;
    kind: InteractionKind;
    direction: InteractionDirection;
    outcome: InteractionOutcome;
    occurredAt: Date;
    contactName: string | null;
  } | null;
  interactionCount: number;
  /** Stage 2. */
  qualification?: { status: string; submittedAt: Date | null; approvedAt: Date | null } | null;
  /** Stage 3: the newest invitation or bid discussion. */
  lastBidActivityAt?: Date | null;
};

export type PlannedFollowUp = {
  sourceKey: string;
  rule: FollowUpRule;
  title: string;
  description: string;
  priority: Priority;
  dueDay: DayKey;
};

export const followUpPrefix = (orgId: string) => `org:${orgId}:followup:`;
export const followUpKey = (orgId: string, rule: FollowUpRule, anchor: string, period: number) => `${followUpPrefix(orgId)}${rule}@${anchor}#${period}`;

const KIND_WORD: Record<InteractionKind, string> = {
  CALL: "call",
  EMAIL: "email",
  MEETING: "meeting",
  SITE_VISIT: "site visit",
  LUNCH: "lunch",
  LINKEDIN: "LinkedIn message",
  INTRO: "introduction",
  PREQUAL_SUBMISSION: "prequalification submission",
  BID_DISCUSSION: "bid discussion",
  DOC_SENT: "documents",
  NOTE: "note",
  OTHER: "message",
};

/** An outbound touch nobody has answered yet. */
const UNANSWERED: ReadonlySet<InteractionOutcome> = new Set(["NO_ANSWER", "LEFT_MESSAGE", "SENT"]);

function longDay(k: DayKey): string {
  return new Date(`${k}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function closed(stage: PartnerStage): boolean {
  return stage === "DORMANT" || stage === "DO_NOT_PURSUE";
}

type Candidate = { rule: FollowUpRule; anchor: string; days: number; threshold: number; title: string; description: string };

function candidates(input: FollowUpInput, today: DayKey, t: FollowUpThresholds): Candidate[] {
  const { org, lastInteraction } = input;
  if (closed(org.stage)) return [];
  const out: Candidate[] = [];
  const createdDay = dayKey(org.createdAt);

  if (org.stage === "TARGET" && input.interactionCount === 0) {
    out.push({
      rule: "new-target",
      anchor: createdDay,
      days: workingDaysBetween(createdDay, today),
      threshold: t.newTargetDays,
      title: `${org.name}: first contact overdue`,
      description: `Added ${longDay(createdDay)} and nobody has reached out yet. Call or email a contact there and log it on the account.`,
    });
  }

  if (lastInteraction && lastInteraction.direction === "OUTBOUND" && UNANSWERED.has(lastInteraction.outcome)) {
    const day = dayKey(lastInteraction.occurredAt);
    const who = lastInteraction.contactName ? `with ${lastInteraction.contactName}` : "with them";
    out.push({
      rule: "no-response",
      anchor: lastInteraction.id,
      days: diffDayKeys(day, today),
      threshold: t.noResponseDays,
      title: `${org.name}: no reply to your ${KIND_WORD[lastInteraction.kind]} on ${longDay(day)}`,
      description: `Follow up ${who} and log the outcome on the account; a reply or a meeting closes this.`,
    });
  }

  const q = input.qualification;
  if (q && q.status === "SUBMITTED" && q.submittedAt) {
    const day = dayKey(q.submittedAt);
    out.push({
      rule: "qual-submitted",
      anchor: day,
      days: diffDayKeys(day, today),
      threshold: t.qualSubmittedDays,
      title: `${org.name}: prequalification submitted ${longDay(day)} — check its status`,
      description: "Ask where the application stands and record the answer on the account's Qualification tab.",
    });
  }

  if (q && q.status === "APPROVED" && (org.stage === "ENGAGED" || org.stage === "ACTIVE")) {
    const since = [q.approvedAt, input.lastBidActivityAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
    if (since) {
      const day = dayKey(since);
      out.push({
        rule: "prequal-no-bids",
        anchor: day,
        days: diffDayKeys(day, today),
        threshold: t.prequalNoBidDays,
        title: `${org.name}: prequalified, no bid activity since ${longDay(day)}`,
        description: "Ask their preconstruction team what is bidding and whether KNU is on the list for it.",
      });
    }
  }

  if (org.stage === "ACTIVE") {
    const since = org.lastContactAt ?? org.createdAt;
    const day = dayKey(since);
    out.push({
      rule: "quiet",
      anchor: "active",
      days: diffDayKeys(day, today),
      threshold: t.activeQuietDays,
      title: `${org.name}: quiet for ${diffDayKeys(day, today)} days — schedule a check-in`,
      description: "An active partner nobody has talked to in a while. A call, a lunch or a site visit logged on the account closes this.",
    });
  }

  return out;
}

/** The follow-ups that apply to one account today, with their period keys. */
export function planFollowUps(input: FollowUpInput, today: DayKey, t: FollowUpThresholds): PlannedFollowUp[] {
  const out: PlannedFollowUp[] = [];
  for (const c of candidates(input, today, t)) {
    if (c.threshold <= 0 || c.days < c.threshold) continue;
    const period = Math.floor(c.days / c.threshold);
    out.push({ sourceKey: followUpKey(input.org.id, c.rule, c.anchor, period), rule: c.rule, title: c.title, description: c.description, priority: "HIGH", dueDay: today });
  }
  return out;
}

/** Source keys of this account's follow-ups that still apply; an open task outside this set has been overtaken. */
export function liveFollowUpKeys(input: FollowUpInput, today: DayKey, t: FollowUpThresholds): Set<string> {
  return new Set(planFollowUps(input, today, t).map((p) => p.sourceKey));
}
