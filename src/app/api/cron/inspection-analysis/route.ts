import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { runDue } from "@/lib/inspector/analyze";
import { inspectorEnabled } from "@/lib/inspector/service";

/**
 * The sweeper for inspection photo batches: runs what an upload's after()
 * did not (a restart, a deploy, a batch retried later). Every minute.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  if (!inspectorEnabled()) return NextResponse.json({ enabled: false, ran: 0 });
  const ran = await runDue({ limit: 6 });
  if (ran) logger.info("cron.inspection-analysis", { ran });
  return NextResponse.json({ enabled: true, ran });
}
