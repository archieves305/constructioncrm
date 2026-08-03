import { NextRequest, NextResponse } from "next/server";
import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { resolveRecipients } from "@/lib/tasks/recipients";
import { taskUrlForRole } from "@/lib/tasks/links";
import { renderTaskReminderEmail, type ReminderItem } from "@/lib/tasks/task-email";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";

/**
 * Morning task nudge: one email per assignee covering everything overdue plus
 * everything due today.
 *
 * Grouped per person rather than per task on purpose — someone with nine
 * overdue items needs a list they can triage in one sitting, and nine separate
 * mails is how a notification channel gets filtered into oblivion.
 *
 * Auth mirrors the other cron routes: `x-cron-secret` must match CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email service is not configured" }, { status: 503 });
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
      assignedUserId: { not: null },
      dueAt: { not: null, lte: todayEnd },
    },
    select: {
      id: true,
      title: true,
      priority: true,
      dueAt: true,
      assignedUserId: true,
      job: { select: { jobNumber: true, title: true } },
      lead: { select: { fullName: true } },
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
  });

  if (tasks.length === 0) {
    return NextResponse.json({ tasks: 0, people: 0, sent: 0, failures: [] });
  }

  // Reuse the same suppression rules the interactive mail uses, so a user who
  // muted task email does not start receiving it again at 7am via the cron.
  const { recipients, skipped } = await resolveRecipients({
    candidates: [
      ...new Set(tasks.map((t) => t.assignedUserId!)),
    ].map((userId) => ({ userId, reason: "assignee" as const })),
  });

  const brand = await getEmailBrand();
  const byUser = new Map(recipients.map((r) => [r.userId, r]));

  let sent = 0;
  const failures: DeliveryFailure[] = [];

  for (const [userId, recipient] of byUser) {
    const mine = tasks.filter((t) => t.assignedUserId === userId);
    const overdue: ReminderItem[] = [];
    const dueToday: ReminderItem[] = [];

    for (const t of mine) {
      const item: ReminderItem = {
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt,
        context: t.job
          ? `${t.job.jobNumber} — ${t.job.title}`
          : (t.lead?.fullName ?? "No job or lead"),
        url: taskUrlForRole(t.id, recipient.role),
        overdue: t.dueAt !== null && t.dueAt < todayStart,
      };
      if (item.overdue) overdue.push(item);
      else dueToday.push(item);
    }

    if (overdue.length === 0 && dueToday.length === 0) continue;

    const email = renderTaskReminderEmail({
      recipientFirstName: recipient.firstName,
      dueToday,
      overdue,
      brand,
    });

    try {
      const result = await sendEmail({
        to: recipient.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (result) sent++;
      else
        failures.push({
          recipient: recipient.email,
          reason: "email provider not configured",
        });
    } catch (err) {
      failures.push({
        recipient: recipient.email,
        reason: err instanceof Error ? err.message : "unknown send error",
      });
      logger.exception(err, { where: "cron.task-reminders", to: recipient.email });
    }
  }

  await reportDelivery({
    source: "cron.task-reminders",
    attempted: byUser.size,
    sent,
    failures,
    context: { tasks: tasks.length },
  });

  logger.info("task-reminders cron done", {
    tasks: tasks.length,
    people: byUser.size,
    sent,
    failures: failures.length,
    suppressed: skipped.filter((s) => s.reason !== "duplicate").length,
  });

  return NextResponse.json({
    tasks: tasks.length,
    people: byUser.size,
    sent,
    failures: failures.map((f) => f.recipient),
  });
}
