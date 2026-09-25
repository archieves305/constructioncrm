import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { isEmailConfigured } from "@/lib/email/send";
import { planSummary, runNurtureTick } from "@/lib/nurture/run";

/**
 * The daily customer follow-up + nurture tick. Scheduled once a weekday
 * morning inside the send window (see NurtureSettings). `?dryRun=1` plans
 * without writing or sending — allowed even when email is unconfigured or
 * the env gate is off, so a day's plan can be inspected before enabling.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1" || request.headers.get("x-dry-run") === "1";
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  if (!dryRun && !isEmailConfigured()) {
    return NextResponse.json({ error: "Email service is not configured" }, { status: 503 });
  }

  try {
    const result = await runNurtureTick(new Date(), { dryRun, limit });
    logger.info("nurture cron done", { where: "cron.nurture", dryRun, summary: planSummary(result), enabled: result.enabled });
    return NextResponse.json(result);
  } catch (err) {
    logger.exception(err, { where: "cron.nurture" });
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown error" }, { status: 500 });
  }
}
