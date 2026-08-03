import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { recordTaskEvent } from "./events";
import { taskUrlForRole } from "./links";
import { resolveRecipients, taskAudience, type Candidate, type TaskRecipient } from "./recipients";
import {
  renderTaskAssignedEmail,
  renderTaskBlockedEmail,
  renderTaskCompletedEmail,
  renderTaskMentionEmail,
  type RenderedEmail,
  type TaskEmailNote,
  type TaskEmailTask,
} from "./task-email";

/**
 * Sending side of task notifications.
 *
 * Everything here is best-effort by design. These are called AFTER the task
 * write has committed — a MailerSend outage must never turn a successful
 * assignment into a 500, because the work item is the thing that matters and
 * the mail is how we tell someone about it. Failures land on the task timeline
 * as EMAIL_FAILED rows so "did he ever get told?" is answerable in-product.
 */

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  blockedReason: true,
  assignedUserId: true,
  job: { select: { jobNumber: true, title: true } },
  lead: { select: { fullName: true } },
  assignedTo: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  completedBy: { select: { firstName: true, lastName: true } },
} as const;

type LoadedTask = TaskEmailTask & { assignedUserId: string | null };

async function loadTask(taskId: string): Promise<LoadedTask | null> {
  return prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
}

async function actorName(actorUserId: string | null): Promise<string> {
  if (!actorUserId) return "The system";
  const u = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  return u ? `${u.firstName} ${u.lastName}`.trim() : "Someone";
}

/**
 * Render per recipient rather than once for everybody: the greeting is
 * personal and, more importantly, the CTA has to differ — a crew lead and an
 * office manager on the same completion mail need different destinations.
 */
async function dispatch(input: {
  taskId: string;
  recipients: TaskRecipient[];
  actorUserId: string | null;
  render: (recipient: TaskRecipient, url: string) => RenderedEmail;
}): Promise<{ sent: number; failed: number }> {
  if (input.recipients.length === 0) return { sent: 0, failed: 0 };

  if (!isEmailConfigured()) {
    logger.warn("task email skipped: MailerSend not configured", {
      taskId: input.taskId,
      recipients: input.recipients.length,
    });
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const r of input.recipients) {
    const url = taskUrlForRole(input.taskId, r.role);
    try {
      const email = input.render(r, url);
      const result = await sendEmail({
        to: r.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (result) {
        sent++;
        await recordTaskEvent({
          taskId: input.taskId,
          actorUserId: input.actorUserId,
          type: "EMAIL_SENT",
          toValue: r.email,
          body: email.subject,
        });
      }
    } catch (err) {
      failed++;
      logger.exception(err, { where: "tasks.dispatch", taskId: input.taskId, to: r.email });
      await recordTaskEvent({
        taskId: input.taskId,
        actorUserId: input.actorUserId,
        type: "EMAIL_FAILED",
        toValue: r.email,
        body: err instanceof Error ? err.message : "Unknown send error",
      });
    }
  }

  return { sent, failed };
}

function logSkips(taskId: string, kind: string, skipped: { userId: string; reason: string }[]) {
  const meaningful = skipped.filter((s) => s.reason !== "duplicate");
  if (meaningful.length > 0) {
    logger.info("task email recipients suppressed", { taskId, kind, skipped: meaningful });
  }
}

/** New owner gets told. Self-assignment tells nobody. */
export async function notifyTaskAssigned(input: {
  taskId: string;
  actorUserId: string | null;
  reassigned?: boolean;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task) return;

  if (!task.assignedUserId) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates: [{ userId: task.assignedUserId, reason: "assignee" }],
    suppressUserId: input.actorUserId,
  });
  logSkips(input.taskId, "assigned", skipped);

  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();

  await dispatch({
    taskId: input.taskId,
    recipients,
    actorUserId: input.actorUserId,
    render: (r, url) =>
      renderTaskAssignedEmail({
        task,
        recipientFirstName: r.firstName,
        actorName: name,
        url,
        brand,
        reassigned: input.reassigned,
      }),
  });
}

/**
 * Completion closes the loop with everyone who was waiting: assignee,
 * assignor, watchers. The actor is NOT suppressed here — a completion receipt
 * is wanted even by the person who clicked, and the assignor/assignee pair is
 * the explicit requirement.
 */
export async function notifyTaskCompleted(input: {
  taskId: string;
  actorUserId: string | null;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task) return;

  const candidates: Candidate[] = await taskAudience(input.taskId);
  const { recipients, skipped } = await resolveRecipients({ candidates });
  logSkips(input.taskId, "completed", skipped);

  const noteRows = await prisma.taskEvent.findMany({
    where: { taskId: input.taskId, type: "NOTE" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      body: true,
      createdAt: true,
      actor: { select: { firstName: true, lastName: true } },
    },
  });
  // Oldest-first so the digest reads as a conversation, not a stack.
  const notes: TaskEmailNote[] = noteRows
    .reverse()
    .filter((n) => n.body)
    .map((n) => ({
      authorName: n.actor ? `${n.actor.firstName} ${n.actor.lastName}`.trim() : "Someone",
      body: n.body!,
      createdAt: n.createdAt,
    }));

  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();

  await dispatch({
    taskId: input.taskId,
    recipients,
    actorUserId: input.actorUserId,
    render: (r, url) =>
      renderTaskCompletedEmail({
        task,
        recipientFirstName: r.firstName,
        actorName: name,
        url,
        brand,
        notes,
      }),
  });
}

/** Blocked work needs the office to know, so this goes to the whole audience. */
export async function notifyTaskBlocked(input: {
  taskId: string;
  actorUserId: string | null;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates: await taskAudience(input.taskId),
    suppressUserId: input.actorUserId,
  });
  logSkips(input.taskId, "blocked", skipped);

  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();

  await dispatch({
    taskId: input.taskId,
    recipients,
    actorUserId: input.actorUserId,
    render: (r, url) =>
      renderTaskBlockedEmail({
        task,
        recipientFirstName: r.firstName,
        actorName: name,
        url,
        brand,
      }),
  });
}

export async function notifyTaskMentions(input: {
  taskId: string;
  actorUserId: string | null;
  mentionedUserIds: string[];
  note: TaskEmailNote;
}): Promise<void> {
  if (input.mentionedUserIds.length === 0) return;
  const task = await loadTask(input.taskId);
  if (!task) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates: input.mentionedUserIds.map((userId) => ({ userId, reason: "mentioned" as const })),
    suppressUserId: input.actorUserId,
  });
  logSkips(input.taskId, "mention", skipped);

  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();

  await dispatch({
    taskId: input.taskId,
    recipients,
    actorUserId: input.actorUserId,
    render: (r, url) =>
      renderTaskMentionEmail({
        task,
        recipientFirstName: r.firstName,
        actorName: name,
        url,
        brand,
        note: input.note,
      }),
  });
}
