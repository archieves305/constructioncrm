import type { PartnerStage } from "@/generated/prisma/enums";
import type { Tone } from "@/lib/ui/tones";

/**
 * What an account looks like today, read from its records: badges beside
 * the stage, the "quiet N days" figure, the facts later stages add
 * (qualification, bids). Pure and client-safe; nothing here is stored.
 */

export type OrgFacts = {
  stage: PartnerStage;
  createdAt: Date | string;
  lastContactAt: Date | string | null;
  interactionCount: number;
  // Later stages fill these in; absent = not known, which draws no badge.
  openBidCount?: number;
  bidCount?: number;
  awardedCount?: number;
  jobCount?: number;
  qualification?: { status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "INFO_REQUESTED" | "APPROVED" | "REJECTED"; expiresAt: Date | string | null } | null;
};

export type OrgBadgeKey = "quiet" | "never-contacted" | "prequal-pending" | "prequalified" | "prequal-expiring" | "first-bid" | "bidding" | "awarded" | "repeat";

export type OrgBadge = { key: OrgBadgeKey; label: string; tone: Tone };

const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, info: 2, success: 3, neutral: 4 };

const MS_DAY = 86_400_000;

function at(d: Date | string): number {
  return (d instanceof Date ? d : new Date(d)).getTime();
}

/** Whole days since `d`; null when there is no date. */
export function daysSince(d: Date | string | null | undefined, now: Date): number | null {
  if (!d) return null;
  return Math.max(0, Math.floor((now.getTime() - at(d)) / MS_DAY));
}

/** Days since the last touch, or since the account was added when nobody has reached out. */
export function quietDays(f: Pick<OrgFacts, "createdAt" | "lastContactAt">, now: Date): number {
  return daysSince(f.lastContactAt ?? f.createdAt, now) ?? 0;
}

export type BadgeSettings = { activeQuietDays: number; prequalExpiringDays?: number };

export function orgBadges(f: OrgFacts, now: Date, s: BadgeSettings): OrgBadge[] {
  const out: OrgBadge[] = [];
  const closed = f.stage === "DORMANT" || f.stage === "DO_NOT_PURSUE";
  const quiet = quietDays(f, now);

  if (!closed && f.interactionCount === 0 && f.stage !== "TARGET") out.push({ key: "never-contacted", label: "Never contacted", tone: "danger" });
  else if (!closed && f.stage !== "TARGET" && quiet >= s.activeQuietDays) out.push({ key: "quiet", label: `Quiet ${quiet} days`, tone: "warning" });

  const q = f.qualification;
  if (q) {
    const expiringDays = s.prequalExpiringDays ?? 60;
    if (q.status === "SUBMITTED" || q.status === "INFO_REQUESTED") out.push({ key: "prequal-pending", label: "Prequal pending", tone: "info" });
    else if (q.status === "APPROVED") {
      const left = q.expiresAt ? Math.floor((at(q.expiresAt) - now.getTime()) / MS_DAY) : null;
      if (left !== null && left < 0) out.push({ key: "prequal-expiring", label: "Prequal expired", tone: "danger" });
      else if (left !== null && left <= expiringDays) out.push({ key: "prequal-expiring", label: `Prequal expires in ${left} d`, tone: "warning" });
      else out.push({ key: "prequalified", label: "Prequalified", tone: "success" });
    }
  }

  if ((f.openBidCount ?? 0) > 0) out.push({ key: "bidding", label: `Bidding · ${f.openBidCount}`, tone: "info" });
  else if ((f.bidCount ?? 0) > 0) out.push({ key: "first-bid", label: "Bid received", tone: "info" });
  if ((f.jobCount ?? 0) >= 2) out.push({ key: "repeat", label: "Repeat work", tone: "success" });
  else if ((f.awardedCount ?? 0) > 0 || (f.jobCount ?? 0) > 0) out.push({ key: "awarded", label: "Awarded", tone: "success" });

  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

/** "12 d ago" / "today" / "never" for list cells. */
export function lastTouchLabel(lastContactAt: Date | string | null, now: Date): string {
  const d = daysSince(lastContactAt, now);
  if (d === null) return "never";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} d ago`;
}
