import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { runBidFollowUps } from "@/lib/bids/follow-ups";

/**
 * Weekdays, every 15 minutes in business hours: raise the bid follow-ups that
 * are due — a call task, or an email draft with its task. Each slot is raised
 * once (unique key); nothing is ever sent from here. `?dryRun=1` plans only.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const result = await runBidFollowUps({ dryRun });
    logger.info("cron.bid-follow-ups", { ...result, planned: result.planned.length, dryRun });
    return NextResponse.json({ ...result, dryRun });
  } catch (err) {
    logger.exception(err, { where: "cron.bid-follow-ups" });
    return NextResponse.json({ error: "Bid follow-up run failed" }, { status: 500 });
  }
}
