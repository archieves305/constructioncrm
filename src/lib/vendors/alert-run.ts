import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { pinAllDay, todayKey, type DayKey } from "@/lib/time/zone";
import { alertsForVendor, liveVendorAlertKeys, vendorAlertKey, vendorAlertPrefix, type PlannedVendorAlert } from "./alerts";
import { DOC_COMPLIANCE_SELECT } from "./compliance-load";

/**
 * Vendor document follow-ups as ordinary tasks: a certificate, exemption or
 * license inside 30 days of its expiry, and again once it has lapsed. The
 * daily cron calls `raiseVendorAlerts`; every document write calls
 * `settleVendorAlerts`, so an alert the record has overtaken (a renewal filed,
 * a date corrected, the document removed) closes by itself.
 *
 * A task is raised once per source key, whatever became of it.
 */

/**
 * Who gets a vendor's expiry tasks: the compliance owner set under Vendors,
 * else the Accounting role default (Admin → Workflow Roles), else the oldest
 * admin. An inactive person is passed over.
 */
export async function complianceOwnerId(): Promise<string | null> {
  const settings = await prisma.vendorSettings.findUnique({
    where: { id: "default" },
    select: { complianceOwner: { select: { id: true, isActive: true } } },
  });
  if (settings?.complianceOwner?.isActive) return settings.complianceOwner.id;
  const accounting = await prisma.workflowRoleDefault.findUnique({ where: { role: "ACCOUNTING" }, select: { user: { select: { id: true, isActive: true } } } });
  if (accounting?.user.isActive) return accounting.user.id;
  const admin = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

async function raise(alert: PlannedVendorAlert, vendorId: string, assignee: string): Promise<boolean> {
  const seen = await prisma.task.findFirst({ where: { sourceKey: alert.sourceKey }, select: { id: true } });
  if (seen) return false;
  await createTask(
    {
      title: alert.title,
      description: alert.description,
      priority: alert.priority,
      dueAt: pinAllDay(alert.dueDay),
      allDay: true,
      assignedUserId: assignee,
      // Nobody raised it but the calendar: the owner is the only person it concerns.
      createdByUserId: assignee,
      vendorId,
      source: "auto",
      sourceKey: alert.sourceKey,
    },
    { actorUserId: null, notify: "inline" },
  );
  return true;
}

export type VendorAlertRun = { vendors: number; expiring: number; expired: number };

/** Daily: raise what is due on every active vendor's documents. */
export async function raiseVendorAlerts(today: DayKey = todayKey()): Promise<VendorAlertRun> {
  const out: VendorAlertRun = { vendors: 0, expiring: 0, expired: 0 };
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true, documents: { some: { expiresAt: { not: null } } } },
    select: { id: true, name: true, documents: { select: DOC_COMPLIANCE_SELECT } },
  });
  out.vendors = vendors.length;
  if (vendors.length === 0) return out;
  const assignee = await complianceOwnerId();
  if (!assignee) return out;
  for (const v of vendors) {
    try {
      for (const alert of alertsForVendor(v, v.documents, today)) {
        if (!(await raise(alert, v.id, assignee))) continue;
        if (alert.kind === "expired") {
          out.expired += 1;
          // One follow-up per document: the lapsed one replaces the reminder.
          const day = alert.sourceKey.split("@")[1];
          await closeAutoTask(vendorAlertKey(v.id, alert.docId, "expiring", day), { actorUserId: null, outcome: "CANCELLED", because: "The document has now expired — the newer follow-up replaces this one" });
        } else out.expiring += 1;
      }
    } catch (err) {
      logger.exception(err, { where: "vendors.raiseVendorAlerts", vendorId: v.id });
    }
  }
  return out;
}

/** After any change to a vendor's documents: close the follow-ups the record has overtaken. Never throws. */
export async function settleVendorAlerts(vendorId: string, actorUserId: string | null, because = "A newer document or date was recorded on the vendor"): Promise<number> {
  try {
    const docs = await prisma.vendorDocument.findMany({ where: { vendorId }, select: DOC_COMPLIANCE_SELECT });
    const live = liveVendorAlertKeys(vendorId, docs);
    const open = await prisma.task.findMany({
      where: { sourceKey: { startsWith: vendorAlertPrefix(vendorId) }, status: { in: [...OPEN_TASK_STATUSES] } },
      select: { sourceKey: true },
    });
    let closed = 0;
    for (const key of new Set(open.map((t) => t.sourceKey as string))) {
      if (live.has(key)) continue;
      closed += (await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because })).closed;
    }
    return closed;
  } catch (err) {
    logger.exception(err, { where: "vendors.settleVendorAlerts", vendorId });
    return 0;
  }
}
