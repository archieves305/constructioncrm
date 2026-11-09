import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { runMyDay } from "@/lib/mobile/my-day";

/** POST /api/cron/my-day (`?dryRun=1` counts only) — the 7 am "your day" push. */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await runMyDay({ dryRun, force });
  logger.info("cron.my-day", { ...result, dryRun });
  return NextResponse.json({ ...result, dryRun });
}
