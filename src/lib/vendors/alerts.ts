import { DOC_TYPE_LABEL, EXPIRING_WITHIN_DAYS, docDay, docInForce, type ComplianceDoc, type DayKey, type RequirementKey } from "./compliance";

/**
 * Which follow-up tasks a vendor's documents call for today. Pure: the cron
 * loads the rows, this decides, `alert-run.ts` writes.
 *
 * Only the document in force for a dated requirement is watched. Each alert
 * is an ordinary task raised once: the source key carries the document and
 * its expiry day, so a corrected date or a newer certificate is a new alert
 * and the old one no longer applies. A document that was never filed raises
 * nothing — it shows on the vendor and the dashboard instead.
 */

/** The expiring task is due this many days before the document lapses. */
export const EXPIRING_DUE_LEAD_DAYS = 14;

const WATCHED: readonly RequirementKey[] = ["liability", "workers_comp", "license"];

export type VendorAlertKind = "expiring" | "expired";

export type PlannedVendorAlert = {
  sourceKey: string;
  kind: VendorAlertKind;
  docId: string;
  title: string;
  description: string;
  priority: "HIGH" | "URGENT";
  dueDay: DayKey;
};

export const vendorAlertPrefix = (vendorId: string) => `vendor:${vendorId}:doc:`;
export const vendorAlertKey = (vendorId: string, docId: string, kind: VendorAlertKind, day: DayKey) => `${vendorAlertPrefix(vendorId)}${docId}:${kind}@${day}`;

function addDays(k: DayKey, n: number): DayKey {
  return new Date(Date.parse(`${k}T12:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`)) / 86_400_000);
}
function longDay(k: DayKey): string {
  return new Date(`${k}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The dated documents in force, one per watched requirement. */
function watchedDocs<D extends ComplianceDoc>(docs: readonly D[]): D[] {
  return WATCHED.map((key) => docInForce(key, docs)).filter((d): d is D => Boolean(d && d.expiresAt));
}

/** The alerts that apply to one vendor today — at most one per document in force. */
export function alertsForVendor(vendor: { id: string; name: string }, docs: readonly ComplianceDoc[], today: DayKey): PlannedVendorAlert[] {
  const out: PlannedVendorAlert[] = [];
  for (const doc of watchedDocs(docs)) {
    const expires = docDay(doc.expiresAt as Date | string);
    const left = diffDays(today, expires);
    const what = DOC_TYPE_LABEL[doc.type].toLowerCase();
    if (left < 0) {
      out.push({
        sourceKey: vendorAlertKey(vendor.id, doc.id, "expired", expires),
        kind: "expired",
        docId: doc.id,
        title: `${vendor.name}: ${what} expired ${longDay(expires)}`,
        description: `It lapsed ${-left} day${left === -1 ? "" : "s"} ago. Ask ${vendor.name} for a current one and add it on the vendor's page. Work is not blocked, but the vendor shows a warning wherever it is used.`,
        priority: "URGENT",
        dueDay: today,
      });
    } else if (left <= EXPIRING_WITHIN_DAYS) {
      const due = addDays(expires, -EXPIRING_DUE_LEAD_DAYS);
      out.push({
        sourceKey: vendorAlertKey(vendor.id, doc.id, "expiring", expires),
        kind: "expiring",
        docId: doc.id,
        title: `${vendor.name}: ${what} expires ${longDay(expires)}`,
        description: `${left === 0 ? "It expires today" : `${left} day${left === 1 ? "" : "s"} left`}. Ask ${vendor.name} for the renewal and add it on the vendor's page.`,
        priority: "HIGH",
        dueDay: due > today ? due : today,
      });
    }
  }
  return out;
}

/** Source keys of this vendor's alerts that still apply; an open alert task outside this set has been overtaken. */
export function liveVendorAlertKeys(vendorId: string, docs: readonly ComplianceDoc[]): Set<string> {
  const keys = new Set<string>();
  for (const doc of watchedDocs(docs)) {
    const day = docDay(doc.expiresAt as Date | string);
    keys.add(vendorAlertKey(vendorId, doc.id, "expiring", day));
    keys.add(vendorAlertKey(vendorId, doc.id, "expired", day));
  }
  return keys;
}
