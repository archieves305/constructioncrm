import type { Priority, QualificationStatus } from "@/generated/prisma/enums";
import { addDayKeys, type DayKey } from "@/lib/time/zone";
import { daysUntil, docDay } from "./qualification-state";

/**
 * Which tasks the vault and the qualifications call for today. Pure: the
 * cron loads the rows, this decides, `document-alert-run.ts` writes.
 *
 * Only the current version of a document type is watched. Each alert is an
 * ordinary task raised once: the key carries the document (or the
 * qualification) and its expiry day, so a new version or a corrected date
 * is a new alert and the old one no longer applies — the vendor pattern.
 */

export const EXPIRING_WITHIN_DAYS = 30;
export const EXPIRING_DUE_LEAD_DAYS = 14;

export type AlertKind = "expiring" | "expired" | "renewal";

export type PlannedAlert = { sourceKey: string; kind: AlertKind; title: string; description: string; priority: Priority; dueDay: DayKey; organizationId: string | null };

export const DOC_ALERT_PREFIX = "company-doc:";
export const docAlertKey = (docId: string, kind: AlertKind, day: DayKey) => `${DOC_ALERT_PREFIX}${docId}:${kind}@${day}`;
export const qualAlertPrefix = (orgId: string) => `org:${orgId}:qual:`;
export const qualAlertKey = (orgId: string, qualId: string, kind: AlertKind, day: DayKey) => `${qualAlertPrefix(orgId)}${qualId}:${kind}@${day}`;

export type CurrentDocRow = { id: string; title: string; typeName: string; expiresAt: Date | string | null; usedBy: string[] };
export type QualRow = { id: string; organizationId: string; organizationName: string; status: QualificationStatus; expiresAt: Date | string | null; renewalDueAt: Date | string | null; platform: string | null };

function longDay(k: DayKey): string {
  return new Date(`${k}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function usedByLine(usedBy: string[]): string {
  if (usedBy.length === 0) return "No active qualification references it yet.";
  return `Used by ${usedBy.length} active qualification${usedBy.length === 1 ? "" : "s"}: ${usedBy.slice(0, 6).join(", ")}${usedBy.length > 6 ? "…" : ""} — upload the new version in the vault, then mark it sent on each.`;
}

/** The alerts the vault calls for today — at most one per current document. */
export function planDocumentAlerts(docs: readonly CurrentDocRow[], today: DayKey): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  for (const d of docs) {
    if (!d.expiresAt) continue;
    const expires = docDay(d.expiresAt);
    const left = daysUntil(d.expiresAt, today)!;
    if (left < 0) {
      out.push({
        sourceKey: docAlertKey(d.id, "expired", expires),
        kind: "expired",
        title: `Vault: ${d.typeName} expired ${longDay(expires)}`,
        description: `"${d.title}" lapsed ${-left} day${left === -1 ? "" : "s"} ago. ${usedByLine(d.usedBy)}`,
        priority: "URGENT",
        dueDay: today,
        organizationId: null,
      });
    } else if (left <= EXPIRING_WITHIN_DAYS) {
      const due = addDayKeys(expires, -EXPIRING_DUE_LEAD_DAYS);
      out.push({
        sourceKey: docAlertKey(d.id, "expiring", expires),
        kind: "expiring",
        title: `Vault: ${d.typeName} expires ${longDay(expires)}`,
        description: `${left === 0 ? "It expires today" : `${left} day${left === 1 ? "" : "s"} left`} on "${d.title}". ${usedByLine(d.usedBy)}`,
        priority: "HIGH",
        dueDay: due > today ? due : today,
        organizationId: null,
      });
    }
  }
  return out;
}

export function liveDocumentAlertKeys(docs: readonly CurrentDocRow[]): Set<string> {
  const keys = new Set<string>();
  for (const d of docs) {
    if (!d.expiresAt) continue;
    const day = docDay(d.expiresAt);
    keys.add(docAlertKey(d.id, "expiring", day));
    keys.add(docAlertKey(d.id, "expired", day));
  }
  return keys;
}

/** The alerts an approved qualification calls for: expiring, expired, or its renewal day reached. */
export function planQualificationAlerts(quals: readonly QualRow[], today: DayKey): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  for (const q of quals) {
    if (q.status !== "APPROVED") continue;
    const where = q.platform ? ` (${q.platform})` : "";
    const left = daysUntil(q.expiresAt, today);
    if (q.expiresAt && left !== null && left < 0) {
      const day = docDay(q.expiresAt);
      out.push({ sourceKey: qualAlertKey(q.organizationId, q.id, "expired", day), kind: "expired", title: `${q.organizationName}: prequalification expired ${longDay(day)}`, description: `KNU is no longer on the approved list${where}. Restart the application on the account's Qualification tab.`, priority: "URGENT", dueDay: today, organizationId: q.organizationId });
      continue;
    }
    if (q.expiresAt && left !== null && left <= EXPIRING_WITHIN_DAYS) {
      const day = docDay(q.expiresAt);
      const due = addDayKeys(day, -EXPIRING_DUE_LEAD_DAYS);
      out.push({ sourceKey: qualAlertKey(q.organizationId, q.id, "expiring", day), kind: "expiring", title: `${q.organizationName}: prequalification expires ${longDay(day)}`, description: `${left === 0 ? "It expires today" : `${left} day${left === 1 ? "" : "s"} left`}${where}. Renew it before KNU drops off their list.`, priority: "HIGH", dueDay: due > today ? due : today, organizationId: q.organizationId });
      continue;
    }
    const renewal = daysUntil(q.renewalDueAt, today);
    if (q.renewalDueAt && renewal !== null && renewal <= 0) {
      const day = docDay(q.renewalDueAt);
      out.push({ sourceKey: qualAlertKey(q.organizationId, q.id, "renewal", day), kind: "renewal", title: `${q.organizationName}: prequalification renewal due`, description: `The renewal was due ${longDay(day)}${where}. Submit it and record the new dates on the account's Qualification tab.`, priority: "HIGH", dueDay: today, organizationId: q.organizationId });
    }
  }
  return out;
}

export function liveQualificationAlertKeys(quals: readonly QualRow[]): Set<string> {
  const keys = new Set<string>();
  for (const q of quals) {
    if (q.status !== "APPROVED") continue;
    if (q.expiresAt) {
      const day = docDay(q.expiresAt);
      keys.add(qualAlertKey(q.organizationId, q.id, "expiring", day));
      keys.add(qualAlertKey(q.organizationId, q.id, "expired", day));
    }
    if (q.renewalDueAt) keys.add(qualAlertKey(q.organizationId, q.id, "renewal", docDay(q.renewalDueAt)));
  }
  return keys;
}
