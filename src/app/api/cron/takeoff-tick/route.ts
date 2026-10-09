import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { abandonedJobIds, tick } from "@/lib/takeoff/pipeline/runner";

/**
 * The sweeper: finishes plan jobs nobody is ticking from a browser (the
 * person closed the tab, the deploy restarted the app). Every minute from the
 * crontab; one job per call, ~40 s budget, so it never overlaps itself badly.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const ids = await abandonedJobIds();
  if (!ids.length) return NextResponse.json({ jobs: 0 });
  const result = await tick(ids[0]);
  logger.info("cron.takeoff-tick", { jobId: ids[0], ...result, waiting: ids.length - 1 });
  return NextResponse.json({ jobs: ids.length, jobId: ids[0], ...result });
}
