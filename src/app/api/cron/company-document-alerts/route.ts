import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { raiseDocumentAlerts } from "@/lib/partners/document-alert-run";

/**
 * Daily sweep of KNU's vault and the approved qualifications: a task for the
 * vault owner when a current document is inside 30 days of its expiry (and
 * again once it has lapsed), and for an account's owner when its
 * prequalification is about to run out or its renewal day has come. Each is
 * raised once, so running this every day never repeats one.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const result = await raiseDocumentAlerts();
    logger.info("cron.company-document-alerts", result);
    return NextResponse.json(result);
  } catch (err) {
    logger.exception(err, { where: "cron.company-document-alerts" });
    return NextResponse.json({ error: "Document alert run failed" }, { status: 500 });
  }
}
