import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { logger } from "@/lib/logger";
import { canManageNotificationSettings, canViewNotificationSettings } from "@/lib/notifications/access";
import { runNotificationTick } from "@/lib/notifications/digest/run";
import { isNotificationsV2Recording } from "@/lib/notifications/settings";

/**
 * "Preview the next digest" (dry run, viewers) and "Run the tick now"
 * (managers only) from the admin page — the same code the crontab calls,
 * behind a session instead of the cron secret.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "0";
  if (dryRun ? !canViewNotificationSettings(session.user.role) : !canManageNotificationSettings(session.user.role)) return forbidden();
  if (!isNotificationsV2Recording()) return NextResponse.json({ recording: false, takeover: false, skipped: "NOTIFICATIONS_V2 is off" });
  try {
    return NextResponse.json(await runNotificationTick(new Date(), { dryRun }));
  } catch (err) {
    logger.exception(err, { where: "admin.notifications.tick", dryRun });
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown error" }, { status: 500 });
  }
}
