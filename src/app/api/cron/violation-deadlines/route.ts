import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { isEmailConfigured } from "@/lib/email/send";
import { runViolationEscalations, runViolationReminders, type ViolationEscalationRunResult, type ViolationReminderRunResult } from "@/lib/violations/reminder-run";

/**
 * The code-violation morning run: deadline reminders (30/14/7/3/1/0 days
 * and daily overdue), then the overdue escalation chain. Fenced so one
 * failing never suppresses the other; idempotent per day through the
 * reminder log's unique key.
 */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    logger.exception(err, { where: `cron.violation-deadlines.${label}` });
    return { error: err instanceof Error ? err.message : "unknown error" };
  }
}

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  if (!isEmailConfigured()) return NextResponse.json({ error: "Email service is not configured" }, { status: 503 });

  const now = new Date();
  const reminders = await safe<ViolationReminderRunResult>("reminders", () => runViolationReminders(now));
  const escalations = await safe<ViolationEscalationRunResult>("escalations", () => runViolationEscalations(now));
  logger.info("violation-deadlines cron done", { where: "cron.violation-deadlines", reminders, escalations });
  const r = "error" in reminders ? null : reminders;
  return NextResponse.json({ reminders, escalations, cases: r?.cases ?? 0, planned: r?.planned ?? 0, people: r?.people ?? 0, sent: r?.sent ?? 0, failures: r?.failures ?? [] });
}
