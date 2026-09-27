import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit/record";
import { sendOpsEmail } from "@/lib/email/delivery-report";
import { escapeHtml } from "@/lib/email/escape";
import { hourBucket } from "./windows";

/**
 * Notification-storm protection. A workflow bug that creates 500 events
 * must not become 500 emails: the classifier demotes IMMEDIATE to DIGEST
 * when a person is over their hourly cap or the whole system is spiking,
 * and this file supplies the two counts plus a once-an-hour alarm.
 */

const HOUR = 3_600_000;
const TEN_MIN = 600_000;

/** IMMEDIATE rows created for each user in the last hour (one query for the whole recipient list). */
export async function immediateCounts(userIds: string[], now: Date): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.notification.groupBy({
    by: ["recipientUserId"],
    where: { recipientUserId: { in: userIds }, deliveryClass: "IMMEDIATE", createdAt: { gte: new Date(now.getTime() - HOUR) } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.recipientUserId, r._count._all]));
}

/**
 * Whether the system as a whole is in a storm: more rows in the last ten
 * minutes than the configured threshold. When it is, an ops alarm goes out
 * once per local hour (audited under NotificationStorm so it is findable).
 */
export async function stormActive(settings: { stormThresholdPer10Min: number; timeZone: string }, now: Date): Promise<boolean> {
  const recent = await prisma.notification.count({ where: { createdAt: { gte: new Date(now.getTime() - TEN_MIN) } } });
  if (recent < settings.stormThresholdPer10Min) return false;
  await noteStorm(recent, settings, now);
  return true;
}

async function noteStorm(recent: number, settings: { stormThresholdPer10Min: number; timeZone: string }, now: Date): Promise<void> {
  const bucket = hourBucket(now, settings.timeZone);
  try {
    const already = await prisma.auditEvent.findFirst({
      where: { entityType: "NotificationStorm", entityId: bucket },
      select: { id: true },
    });
    if (already) return;
    logger.error("NOTIFICATION_STORM", { where: "notifications.storm", recent, threshold: settings.stormThresholdPer10Min, bucket });
    await recordAudit({
      actorUserId: null,
      entityType: "NotificationStorm",
      entityId: bucket,
      action: "storm",
      after: { recent, threshold: settings.stormThresholdPer10Min },
    });
    await sendOpsEmail({
      subject: `[CRM] Notification storm: ${recent} notifications in 10 minutes`,
      bodyHtml: `<p><strong>${recent}</strong> notifications were created in the last ten minutes (threshold ${settings.stormThresholdPer10Min}). Immediate emails are being folded into digests until it passes.</p><p style="font-size:13px;color:#6b7280">Bucket ${escapeHtml(bucket)}. Check the workflow engine and the most recent notification rows for a loop.</p>`,
      bodyText: `${recent} notifications were created in the last ten minutes (threshold ${settings.stormThresholdPer10Min}). Immediate emails are being folded into digests until it passes.\nBucket ${bucket}.`,
    });
  } catch (err) {
    logger.exception(err, { where: "notifications.storm.note" });
  }
}
