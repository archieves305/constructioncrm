import { endOfDay, startOfDay } from "date-fns";
import type { CustomerInput, JobLabelInput } from "@/lib/labels/job";
import { jobTextWithCustomer } from "@/lib/labels/job";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { recordTaskEvent } from "./events";
import { taskUrlForRole } from "./links";
import { resolveRecipients, type Candidate } from "./recipients";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { renderTaskReminderEmail, type CustomReminderItem, type ReminderItem } from "./task-email";

/**
 * The morning digest: one email per person with everything overdue,
 * everything due today, and every "remind me on…" that fell due.
 *
 * Grouped per person rather than per task on purpose — someone with nine
 * overdue items needs a list they can triage in one sitting, and nine
 * separate mails is how a notification channel gets filtered into oblivion.
 */

type DueTask = {
  id: string;
  title: string;
  priority: ReminderItem["priority"];
  dueAt: Date | null;
  assignedUserId: string | null;
  job: (JobLabelInput & { id: string }) | null;
  lead: (CustomerInput & { id: string }) | null;
};

type ReminderTask = DueTask & {
  createdByUserId: string;
  remindSetByUserId: string | null;
  remindSetBy: { firstName: string; lastName: string } | null;
};

export type PersonDigest = {
  overdue: DueTask[];
  dueToday: DueTask[];
  /** `primary` = the assignee (or creator when unassigned); `setter` = whoever asked. */
  reminders: { task: ReminderTask; role: "primary" | "setter" }[];
};

/** Pure: who gets which items. */
export function planDigest(
  dueTasks: DueTask[],
  reminderTasks: ReminderTask[],
  todayStart: Date,
): Map<string, PersonDigest> {
  const out = new Map<string, PersonDigest>();
  const bucket = (userId: string) => {
    const b = out.get(userId) ?? { overdue: [], dueToday: [], reminders: [] };
    out.set(userId, b);
    return b;
  };
  for (const t of dueTasks) {
    if (!t.assignedUserId) continue;
    const b = bucket(t.assignedUserId);
    if (t.dueAt && t.dueAt < todayStart) b.overdue.push(t);
    else b.dueToday.push(t);
  }
  for (const t of reminderTasks) {
    const primary = t.assignedUserId ?? t.createdByUserId;
    bucket(primary).reminders.push({ task: t, role: "primary" });
    if (t.remindSetByUserId && t.remindSetByUserId !== primary) {
      bucket(t.remindSetByUserId).reminders.push({ task: t, role: "setter" });
    }
  }
  return out;
}

export type DigestRunResult = {
  tasks: number;
  reminders: number;
  people: number;
  sent: number;
  failures: string[];
};

const TASK_SELECT = {
  id: true,
  title: true,
  priority: true,
  dueAt: true,
  assignedUserId: true,
  job: { select: JOB_LABEL_SELECT },
  lead: { select: LEAD_LABEL_SELECT },
} as const;

export async function runMorningDigest(now: Date = new Date()): Promise<DigestRunResult> {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const [dueTasks, reminderTasks] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...ACTIVE_OPEN_WHERE,
        assignedUserId: { not: null },
        dueAt: { not: null, lte: todayEnd },
      },
      select: TASK_SELECT,
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    }),
    prisma.task.findMany({
      where: {
        ...ACTIVE_OPEN_WHERE,
        remindAt: { not: null, lte: todayEnd },
        remindedAt: null,
      },
      select: {
        ...TASK_SELECT,
        createdByUserId: true,
        remindSetByUserId: true,
        remindSetBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ remindAt: "asc" }],
    }),
  ]);

  const plan = planDigest(dueTasks, reminderTasks, todayStart);
  if (plan.size === 0) return { tasks: 0, reminders: 0, people: 0, sent: 0, failures: [] };

  // Same suppression rules as interactive mail, on the reminder channel, so a
  // muted user does not start hearing from the cron at 7am.
  const candidates: Candidate[] = [...plan.entries()].map(([userId, d]) => ({
    userId,
    reason: d.overdue.length + d.dueToday.length > 0 || d.reminders.some((r) => r.role === "primary")
      ? ("assignee" as const)
      : ("reminder-setter" as const),
  }));
  const { recipients } = await resolveRecipients({ candidates, channel: "reminder" });
  const brand = await getEmailBrand();

  const context = (t: DueTask) =>
    t.job ? jobTextWithCustomer(t.job) : (t.lead?.fullName ?? "No job or lead");

  let sent = 0;
  const failures: DeliveryFailure[] = [];

  for (const r of recipients) {
    const d = plan.get(r.userId);
    if (!d) continue;
    const toItem = (t: DueTask, overdue: boolean): ReminderItem => ({
      title: t.title,
      priority: t.priority,
      dueAt: t.dueAt,
      context: context(t),
      url: taskUrlForRole(t.id, r.role),
      overdue,
    });
    const reminders: CustomReminderItem[] = d.reminders.map(({ task, role }) => ({
      ...toItem(task, false),
      setByName:
        role === "primary" && task.remindSetBy && task.remindSetByUserId !== r.userId
          ? `${task.remindSetBy.firstName} ${task.remindSetBy.lastName}`.trim()
          : null,
    }));

    const email = renderTaskReminderEmail({
      recipientFirstName: r.firstName,
      overdue: d.overdue.map((t) => toItem(t, true)),
      dueToday: d.dueToday.map((t) => toItem(t, false)),
      reminders,
      brand,
    });

    try {
      const result = await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (!result) {
        failures.push({ recipient: r.email, reason: "email provider not configured" });
        continue;
      }
      sent++;
      // Only the primary recipient's copy retires the reminder; a setter-only
      // send must not silence the assignee's.
      for (const { task, role } of d.reminders) {
        if (role !== "primary") continue;
        await prisma.task.update({ where: { id: task.id }, data: { remindedAt: now } });
        await recordTaskEvent({ taskId: task.id, actorUserId: null, type: "REMINDER_SENT", toValue: r.email });
      }
    } catch (err) {
      failures.push({ recipient: r.email, reason: err instanceof Error ? err.message : "unknown send error" });
      logger.exception(err, { where: "cron.task-reminders", to: r.email });
    }
  }

  await reportDelivery({
    source: "cron.task-reminders",
    attempted: recipients.length,
    sent,
    failures,
    context: { tasks: dueTasks.length, reminders: reminderTasks.length },
  });

  return {
    tasks: dueTasks.length,
    reminders: reminderTasks.length,
    people: recipients.length,
    sent,
    failures: failures.map((f) => f.recipient),
  };
}
