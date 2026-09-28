import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { isEmailConfigured } from "@/lib/email/send";
import { validateBody } from "@/lib/validation/body";
import { canManageNotificationSettings, canViewNotificationSettings } from "@/lib/notifications/access";
import { KINDS, NOTIFICATION_KINDS } from "@/lib/notifications/kinds";
import { invalidateNotificationSettingsCache, isNotificationsV2Recording, loadNotificationSettings, windowSettingsOf } from "@/lib/notifications/settings";
import { dueWindow, nextWindow } from "@/lib/notifications/windows";
import { notificationSettingsSchema } from "@/lib/validators/notifications";

/** Admin → Notification Digests → Delivery: the company switch and the windows. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNotificationSettings(session.user.role)) return forbidden();
  const settings = await loadNotificationSettings();
  const ws = windowSettingsOf(settings);
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [byClass, byState, digests] = await Promise.all([
    prisma.notification.groupBy({ by: ["deliveryClass"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.notification.groupBy({ by: ["state"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.notificationDigest.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return NextResponse.json({
    settings,
    envEnabled: isNotificationsV2Recording(),
    emailConfigured: isEmailConfigured(),
    appBaseUrl: env.APP_BASE_URL,
    dueWindowKey: dueWindow(now, ws)?.key ?? null,
    nextWindowKey: nextWindow(now, ws).key,
    kinds: NOTIFICATION_KINDS.map((k) => ({ kind: k, label: KINDS[k].label, category: KINDS[k].category, defaultClass: KINDS[k].defaultClass, neverDemote: Boolean(KINDS[k].neverDemote) })),
    stats7d: {
      byClass: Object.fromEntries(byClass.map((c) => [c.deliveryClass, c._count._all])),
      byState: Object.fromEntries(byState.map((c) => [c.state, c._count._all])),
      digests: Object.fromEntries(digests.map((c) => [c.status, c._count._all])),
    },
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageNotificationSettings(session.user.role)) return forbidden();
  const v = await validateBody(request, notificationSettingsSchema);
  if (!v.ok) return v.response;
  const before = await loadNotificationSettings();
  const settings = await prisma.notificationSettings.update({ where: { id: "default" }, data: { ...v.data, updatedByUserId: session.user.id } });
  invalidateNotificationSettingsCache();
  await recordAudit({ actorUserId: session.user.id, entityType: "NotificationSettings", entityId: "default", action: v.data.enabled !== undefined && v.data.enabled !== before.enabled ? (v.data.enabled ? "enable" : "disable") : "update", before, after: v.data });
  return NextResponse.json({ settings });
}
