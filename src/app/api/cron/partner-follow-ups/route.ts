import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { raisePartnerFollowUps } from "@/lib/partners/follow-up-run";

/**
 * Daily (weekday mornings): raise the account follow-ups that are due — a
 * target nobody has called, an unanswered touch, an active partner gone
 * quiet. Each is raised once per key; `?dryRun=1` reports without writing.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const result = await raisePartnerFollowUps(undefined, { dryRun });
    logger.info("cron.partner-follow-ups", { ...result, planned: undefined, dryRun });
    return NextResponse.json({ ...result, dryRun });
  } catch (err) {
    logger.exception(err, { where: "cron.partner-follow-ups" });
    return NextResponse.json({ error: "Follow-up run failed" }, { status: 500 });
  }
}
