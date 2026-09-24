import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { isEmailConfigured } from "@/lib/email/send";
import { runMorningDigest, type DigestRunResult } from "@/lib/tasks/reminders";
import { runEscalations, type EscalationRunResult } from "@/lib/tasks/escalations";

/**
 * The 7:30am task run: the per-person digest (overdue, due today, custom
 * reminders) and then overdue escalations. Each pass is fenced so one
 * failing cannot suppress the other. The top-level `tasks/people/sent/
 * failures` keys are kept so the droplet wrapper's log greps keep working.
 */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    logger.exception(err, { where: `cron.task-reminders.${label}` });
    return { error: err instanceof Error ? err.message : "unknown error" };
  }
}

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email service is not configured" }, { status: 503 });
  }

  const now = new Date();
  const digest = await safe<DigestRunResult>("digest", () => runMorningDigest(now));
  const escalations = await safe<EscalationRunResult>("escalations", () => runEscalations(now));

  logger.info("task-reminders cron done", { where: "cron.task-reminders", digest, escalations });

  const d = "error" in digest ? null : digest;
  return NextResponse.json({
    digest,
    escalations,
    tasks: d?.tasks ?? 0,
    people: d?.people ?? 0,
    sent: d?.sent ?? 0,
    failures: d?.failures ?? [],
  });
}
