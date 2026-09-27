import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { isNotificationsV2Recording } from "@/lib/notifications/settings";
import { runNotificationTick } from "@/lib/notifications/digest/run";

/**
 * The notifications tick: every 10 minutes from the droplet crontab.
 * `?dryRun=1` reports the plan (per-person pending digest rows, the due
 * window) and sends nothing. With NOTIFICATIONS_V2 off it answers 200 with
 * `recording: false` so the wrapper's log line stays boring.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  if (!isNotificationsV2Recording()) {
    return NextResponse.json({ recording: false, takeover: false, skipped: "NOTIFICATIONS_V2 is off" });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const result = await runNotificationTick(new Date(), { dryRun });
    return NextResponse.json(result);
  } catch (err) {
    logger.exception(err, { where: "cron.notifications" });
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown error" }, { status: 500 });
  }
}
