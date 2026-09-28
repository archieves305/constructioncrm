import { format } from "date-fns";
import { APP_TIME_ZONE, dayKey, dayKeyToLocalDate, endOfDayIn, startOfDayIn, todayKey } from "@/lib/time/zone";
import type { CustomerInput, JobLabelInput } from "@/lib/labels/job";
import { jobTextWithCustomer } from "@/lib/labels/job";
import { formatTimeRange } from "@/lib/calendar/agenda";
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
import { isDeliveryTakenOver, loadNotificationSettings } from "@/lib/notifications/settings";
import { renderTaskReminderEmail, type CustomReminderItem, type ReminderItem, type ScheduleChangeItem, type StartingItem } from "./task-email";

/**
 * The morning digest: one email per person with everything overdue,
 * everything due today, and every "remind me on…" that fell due.
 *
 * Grouped per person rather than per task on purpose — someone with nine
 * overdue items needs a list they can triage in one sitting, and nine
 * separate mails is how a notification channel gets filtered into oblivion.
 */

export type DueTask = {
  id: string;
  title: string;
  priority: ReminderItem["priority"];
  dueAt: Date | null;
  assignedUserId: string | null;
  job: (JobLabelInput & { id: string }) | null;
  lead: (CustomerInput & { id: string }) | null;
};

export type ReminderTask = DueTask & {
  createdByUserId: string;
  remindSetByUserId: string | null;
  remindSetBy: { firstName: string; lastName: string } | null;
};

/** A DUE_CHANGED / SCHEDULE_CHANGED event since the last digest, with the task it moved. */
export type ScheduleChange = {
  taskId: string;
  type: "DUE_CHANGED" | "SCHEDULE_CHANGED";
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  actor: { firstName: string; lastName: string } | null;
  task: DueTask & { scheduledStart: Date | null; allDay: boolean };
};

/** A job whose target start is today, with the people who should hear it. */
export type JobStart = { id: string; title: string; job: JobLabelInput & { id: string }; userIds: string[] };

export type PersonDigest = {
  overdue: DueTask[];
  dueToday: DueTask[];
  /** `primary` = the assignee (or creator when unassigned); `setter` = whoever asked. */
  reminders: { task: ReminderTask; role: "primary" | "setter" }[];
  /** The latest move per task since yesterday's digest, for the task's assignee. */
  changed: ScheduleChange[];
  starting: JobStart[];
};

/** Pure: who gets which items. */
export function planDigest(
  dueTasks: DueTask[],
  reminderTasks: ReminderTask[],
  todayStart: Date,
  changes: ScheduleChange[] = [],
  starts: JobStart[] = [],
): Map<string, PersonDigest> {
  const out = new Map<string, PersonDigest>();
  const bucket = (userId: string) => {
    const b = out.get(userId) ?? { overdue: [], dueToday: [], reminders: [], changed: [], starting: [] };
    out.set(userId, b);
    return b;
  };
  // One line per task: the latest move wins; the assignee hears it unless they made it themselves.
  const latest = new Map<string, ScheduleChange>();
  for (const c of changes) {
    const prev = latest.get(c.taskId);
    if (!prev || c.createdAt > prev.createdAt) latest.set(c.taskId, c);
  }
  for (const c of latest.values()) {
    if (!c.task.assignedUserId) continue;
    bucket(c.task.assignedUserId).changed.push(c);
  }
  for (const s of starts) for (const userId of new Set(s.userIds)) bucket(userId).starting.push(s);
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
  changes: number;
  starts: number;
  people: number;
  sent: number;
  failures: string[];
  /** Set when the legacy run stood down (notifications v2 owns delivery). */
  skipped?: string;
};

/** "Tue, Sep 29" for an all-day task, "Tue, Sep 29 · 9:00 – 11:00 AM" for a timed one. */
export function describeWhen(t: { dueAt: Date | null; scheduledStart: Date | null; allDay: boolean }, tz: string = APP_TIME_ZONE): string {
  if (!t.dueAt) return "No date";
  const day = format(dayKeyToLocalDate(dayKey(t.dueAt, tz)), "EEE, MMM d");
  if (t.allDay || !t.scheduledStart) return day;
  return `${day} · ${formatTimeRange(t.scheduledStart.toISOString(), t.dueAt.toISOString())}`;
}

/** The "from" side of a change, read back from the event when it recorded one. */
export function describeFrom(c: ScheduleChange, tz: string = APP_TIME_ZONE): string {
  if (!c.fromValue) return "Unscheduled";
  if (c.type === "DUE_CHANGED") {
    const d = new Date(c.fromValue);
    return Number.isNaN(d.getTime()) ? c.fromValue : format(dayKeyToLocalDate(dayKey(d, tz)), "EEE, MMM d");
  }
  try {
    const w = JSON.parse(c.fromValue) as { start?: string | null; end?: string | null; allDay?: boolean };
    if (w.end) return describeWhen({ dueAt: new Date(w.end), scheduledStart: w.start ? new Date(w.start) : null, allDay: w.allDay ?? true }, tz);
  } catch {
    /* not JSON */
  }
  return "Earlier";
}

const TASK_SELECT = {
  id: true,
  title: true,
  priority: true,
  dueAt: true,
  assignedUserId: true,
  job: { select: JOB_LABEL_SELECT },
  lead: { select: LEAD_LABEL_SELECT },
} as const;

/** Custom "remind me on…" rows that fell due, not yet delivered. */
export async function loadDueReminders(todayEnd: Date): Promise<ReminderTask[]> {
  return prisma.task.findMany({
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
  });
}

/** DUE_CHANGED / SCHEDULE_CHANGED on active open assigned tasks since `since`. */
export async function loadScheduleChanges(since: Date): Promise<ScheduleChange[]> {
  const events = await prisma.taskEvent.findMany({
    where: {
      type: { in: ["DUE_CHANGED", "SCHEDULE_CHANGED"] },
      createdAt: { gte: since },
      task: { ...ACTIVE_OPEN_WHERE, assignedUserId: { not: null } },
    },
    select: {
      taskId: true,
      type: true,
      fromValue: true,
      toValue: true,
      createdAt: true,
      actor: { select: { firstName: true, lastName: true } },
      task: { select: { ...TASK_SELECT, scheduledStart: true, allDay: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return events.map((e) => ({
    taskId: e.taskId,
    type: e.type as "DUE_CHANGED" | "SCHEDULE_CHANGED",
    fromValue: e.fromValue,
    toValue: e.toValue,
    createdAt: e.createdAt,
    actor: e.actor,
    task: e.task,
  }));
}

/** Open jobs whose target start falls in the window, with everyone who should hear it. */
export async function loadJobStarts(from: Date, to: Date): Promise<JobStart[]> {
  const jobs = await prisma.job.findMany({
    where: { targetStartDate: { gte: from, lte: to }, currentStage: { isClosed: false } },
    select: {
      ...JOB_LABEL_SELECT,
      projectManagerId: true,
      salesRepId: true,
      fieldAssignments: { select: { userId: true } },
      workflow: { select: { team: { select: { userId: true } } } },
    },
  });
  return jobs.map((j) => ({
    id: j.id,
    title: jobTextWithCustomer(j),
    job: j,
    userIds: [j.projectManagerId, j.salesRepId, ...j.fieldAssignments.map((f) => f.userId), ...(j.workflow?.team.map((t) => t.userId) ?? [])].filter((x): x is string => Boolean(x)),
  }));
}

/** Mark custom reminders delivered (by the digest that carried them). */
export async function retireReminders(taskIds: string[], now: Date, toValue: string): Promise<void> {
  for (const id of taskIds) {
    await prisma.task.update({ where: { id }, data: { remindedAt: now } });
    await recordTaskEvent({ taskId: id, actorUserId: null, type: "REMINDER_SENT", toValue });
  }
}

export async function runMorningDigest(now: Date = new Date()): Promise<DigestRunResult> {
  // Notifications v2 folds this mail into the first digest window of the day
  // (lib/notifications/digest/agenda.ts); with delivery taken over this run
  // stands down so nobody hears the same morning twice.
  if (isDeliveryTakenOver(await loadNotificationSettings())) {
    return { tasks: 0, reminders: 0, changes: 0, starts: 0, people: 0, sent: 0, failures: [], skipped: "notifications v2 owns delivery" };
  }

  // The office's day, not the server's: the droplet runs UTC and 7:30am ET is
  // 11:30Z, so a server-local midnight only worked by coincidence.
  const today = todayKey(now);
  const todayStart = startOfDayIn(today);
  const todayEnd = endOfDayIn(today);

  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [dueTasks, reminderTasks, changes, starts] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...ACTIVE_OPEN_WHERE,
        assignedUserId: { not: null },
        dueAt: { not: null, lte: todayEnd },
      },
      select: TASK_SELECT,
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    }),
    loadDueReminders(todayEnd),
    loadScheduleChanges(since),
    loadJobStarts(todayStart, todayEnd),
  ]);

  const plan = planDigest(dueTasks, reminderTasks, todayStart, changes, starts);
  if (plan.size === 0) return { tasks: 0, reminders: 0, changes: 0, starts: 0, people: 0, sent: 0, failures: [] };

  // Same suppression rules as interactive mail, on the reminder channel, so a
  // muted user does not start hearing from the cron at 7am.
  const candidates: Candidate[] = [...plan.entries()].map(([userId, d]) => ({
    userId,
    reason: d.overdue.length + d.dueToday.length + d.changed.length + d.starting.length > 0 || d.reminders.some((r) => r.role === "primary")
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

    // A move the recipient made themselves is not news to them.
    const changed: ScheduleChangeItem[] = d.changed
      .filter((c) => !(c.actor && r.firstName === c.actor.firstName && r.lastName === c.actor.lastName))
      .map((c) => ({
        title: c.task.title,
        context: context(c.task),
        url: taskUrlForRole(c.task.id, r.role),
        from: describeFrom(c),
        to: describeWhen(c.task),
        byName: c.actor ? `${c.actor.firstName} ${c.actor.lastName}`.trim() : null,
      }));
    const starting: StartingItem[] = d.starting.map((s) => ({ title: s.title, context: "Target start date is today", url: `${process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? ""}/jobs/${s.id}` }));
    if (d.overdue.length + d.dueToday.length + d.reminders.length + changed.length + starting.length === 0) continue;

    const email = renderTaskReminderEmail({
      recipientFirstName: r.firstName,
      overdue: d.overdue.map((t) => toItem(t, true)),
      dueToday: d.dueToday.map((t) => toItem(t, false)),
      reminders,
      changed,
      starting,
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
    context: { tasks: dueTasks.length, reminders: reminderTasks.length, changes: changes.length, starts: starts.length },
  });

  return {
    tasks: dueTasks.length,
    reminders: reminderTasks.length,
    changes: changes.length,
    starts: starts.length,
    people: recipients.length,
    sent,
    failures: failures.map((f) => f.recipient),
  };
}
