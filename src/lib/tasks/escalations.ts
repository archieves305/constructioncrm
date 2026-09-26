import { startOfDay } from "date-fns";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { daysOverdue } from "./due-dates";
import { recordTaskEvent } from "./events";
import { taskUrlForRole } from "./links";
import { managerCandidates, resolveRecipients, type Candidate } from "./recipients";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { renderTaskEscalationEmail, type EscalationItem, type TaskEmailNote } from "./task-email";

/**
 * Overdue escalation: when a task has sat past its due date for N days, tell
 * the person who raised it; past M days, tell the managers too.
 *
 * The planner is pure and the ledger lives on the task (`escalationLevel`),
 * so a task that was already escalated is not escalated again tomorrow, and
 * a task that jumped two thresholds while the cron was off gets ONE mail,
 * not two. A new due date resets the level (see `updateTask`).
 */

export type EscalationThresholds = number[];

export function parseThresholds(raw: string): EscalationThresholds {
  return [...new Set(raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
}

export type EscalationPlan = {
  taskId: string;
  fromLevel: number;
  toLevel: number;
  daysOverdue: number;
};

type Plannable = { id: string; dueAt: Date | null; escalationLevel: number };

/** Which tasks crossed a new threshold. `toLevel` = count of thresholds passed. */
export function planEscalations(
  tasks: Plannable[],
  thresholds: EscalationThresholds,
  today: Date,
): EscalationPlan[] {
  const out: EscalationPlan[] = [];
  for (const t of tasks) {
    if (!t.dueAt) continue;
    const overdue = daysOverdue(t.dueAt, today);
    const toLevel = thresholds.filter((d) => overdue >= d).length;
    if (toLevel > t.escalationLevel) {
      out.push({ taskId: t.id, fromLevel: t.escalationLevel, toLevel, daysOverdue: overdue });
    }
  }
  return out;
}

/**
 * Who hears about a task at a given level. The assignor is skipped when they
 * are also the assignee — they already get the morning digest, and escalating
 * someone to themselves is noise. Managers join at the second threshold.
 */
export function escalationAudience(
  plan: EscalationPlan,
  task: { assignedUserId: string | null; createdByUserId: string },
  managers: Candidate[],
): Candidate[] {
  const out: Candidate[] = [];
  if (task.createdByUserId !== task.assignedUserId) {
    out.push({ userId: task.createdByUserId, reason: "assignor" });
  }
  if (plan.toLevel >= 2) {
    for (const m of managers) if (m.userId !== task.assignedUserId) out.push(m);
  }
  return out;
}

export type EscalationRunResult = {
  enabled: boolean;
  tasks: number;
  escalated: number;
  people: number;
  sent: number;
  failures: string[];
};

export async function runEscalations(now: Date = new Date()): Promise<EscalationRunResult> {
  const zero: EscalationRunResult = { enabled: true, tasks: 0, escalated: 0, people: 0, sent: 0, failures: [] };
  if (env.TASK_ESCALATIONS_ENABLED !== "1") return { ...zero, enabled: false };

  const thresholds = parseThresholds(env.TASK_ESCALATION_DAYS);
  if (thresholds.length === 0) return zero;
  const today = startOfDay(now);

  const tasks = await prisma.task.findMany({
    where: {
      ...ACTIVE_OPEN_WHERE,
      assignedUserId: { not: null },
      dueAt: { lt: today },
    },
    select: {
      id: true,
      title: true,
      priority: true,
      dueAt: true,
      escalationLevel: true,
      assignedUserId: true,
      createdByUserId: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      job: { select: JOB_LABEL_SELECT },
      lead: { select: LEAD_LABEL_SELECT },
      events: {
        where: { type: "NOTE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  const plans = planEscalations(tasks, thresholds, today);
  if (plans.length === 0) return { ...zero, tasks: tasks.length };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const managers = await managerCandidates();

  // recipient userId -> plans they should hear about
  const perUser = new Map<string, EscalationPlan[]>();
  const candidates: Candidate[] = [];
  for (const plan of plans) {
    const task = byId.get(plan.taskId)!;
    for (const c of escalationAudience(plan, task, managers)) {
      if (!c.userId) continue;
      candidates.push(c);
      const list = perUser.get(c.userId) ?? [];
      if (!list.some((p) => p.taskId === plan.taskId)) list.push(plan);
      perUser.set(c.userId, list);
    }
  }

  const { recipients } = await resolveRecipients({ candidates, channel: "escalation" });
  const brand = await getEmailBrand();
  const managerDays = thresholds[1] ?? thresholds[0];

  let sent = 0;
  const failures: DeliveryFailure[] = [];
  const succeededTasks = new Map<string, string[]>(); // taskId -> emails

  for (const r of recipients) {
    const mine = perUser.get(r.userId) ?? [];
    if (mine.length === 0) continue;
    const items: EscalationItem[] = mine.map((plan) => {
      const t = byId.get(plan.taskId)!;
      const note = t.events[0];
      const lastNote: TaskEmailNote | null =
        note?.body
          ? {
              authorName: note.actor ? `${note.actor.firstName} ${note.actor.lastName}`.trim() : "Someone",
              body: note.body,
              createdAt: note.createdAt,
            }
          : null;
      return {
        title: t.title,
        assigneeName: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}`.trim() : "Unassigned",
        daysOverdue: plan.daysOverdue,
        dueAt: t.dueAt,
        priority: t.priority,
        level: plan.toLevel,
        context: t.job ? `${t.job.jobNumber} — ${t.job.title}` : (t.lead?.fullName ?? "No job or lead"),
        url: taskUrlForRole(t.id, r.role),
        lastNote,
      };
    });

    const email = renderTaskEscalationEmail({
      recipientFirstName: r.firstName,
      recipientReason: r.reason === "manager" ? "manager" : "assignor",
      items,
      managerThresholdDays: managerDays,
      brand,
    });

    try {
      const result = await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (result) {
        sent++;
        for (const plan of mine) {
          succeededTasks.set(plan.taskId, [...(succeededTasks.get(plan.taskId) ?? []), r.email]);
        }
      } else {
        failures.push({ recipient: r.email, reason: "email provider not configured" });
      }
    } catch (err) {
      failures.push({ recipient: r.email, reason: err instanceof Error ? err.message : "unknown send error" });
      logger.exception(err, { where: "cron.task-escalations", to: r.email });
    }
  }

  // Advance the ledger only for tasks somebody was actually told about, so a
  // provider outage retries tomorrow instead of marking the level done.
  for (const plan of plans) {
    const emails = succeededTasks.get(plan.taskId);
    if (!emails) continue;
    await prisma.task.update({
      where: { id: plan.taskId },
      data: { escalationLevel: plan.toLevel, lastEscalatedAt: now },
    });
    await recordTaskEvent({
      taskId: plan.taskId,
      actorUserId: null,
      type: "ESCALATED",
      fromValue: String(plan.fromLevel),
      toValue: String(plan.toLevel),
      body: emails.join(", "),
    });
  }

  await reportDelivery({
    source: "cron.task-escalations",
    attempted: recipients.length,
    sent,
    failures,
    context: { tasks: tasks.length, plans: plans.length },
  });

  return {
    enabled: true,
    tasks: tasks.length,
    escalated: succeededTasks.size,
    people: recipients.length,
    sent,
    failures: failures.map((f) => f.recipient),
  };
}
