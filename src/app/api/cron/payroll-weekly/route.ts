import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendWeeklyPayrollEmail } from "@/lib/labor/payroll-email";
import { logger } from "@/lib/logger";

// Friday-evening payroll email: sends the CURRENT payroll week's hours to
// the bookkeeper so she can run payment before the weekend. Same audited
// path as the Field Mode button. Skips quietly (200 with skipped=true) when
// nothing to send or no bookkeeper configured — cron shouldn't page anyone.
//
// Auth mirrors the other cron routes: `x-cron-secret` must match CRON_SECRET.
export async function POST(request: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 503 },
    );
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = await sendWeeklyPayrollEmail({
      weekStart: today,
      triggeredByUserId: null,
      triggeredByLabel: "the Friday payroll schedule",
    });
    if (!result.ok) {
      logger.info("payroll-weekly cron skipped", { reason: result.reason });
      return NextResponse.json({ skipped: true, reason: result.reason });
    }
    logger.info("payroll-weekly cron sent", {
      weekStart: result.weekStart,
      workers: result.workers,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.exception(err, { where: "cron.payroll-weekly" });
    return NextResponse.json({ error: "send failed" }, { status: 502 });
  }
}
