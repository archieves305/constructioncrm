import { prisma } from "@/lib/db/prisma";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { subjectText } from "@/lib/labels/subject";
import { logger } from "@/lib/logger";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { recordTaskEvent } from "./events";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { taskUrlForRole } from "./links";
import { resolveRecipients, taskAudience, type Candidate, type TaskRecipient } from "./recipients";
import {
  renderTaskAssignedEmail,
  renderTaskBlockedEmail,
  renderTaskCompletedEmail,
  renderTaskMentionEmail,
  renderTaskNudgeEmail,
  type RenderedEmail,
  type TaskEmailNote,
  type TaskEmailTask,
} from "./task-email";
import { notify, type NotifyBatch, type NotifySubject } from "@/lib/notifications/notify";
import type { Signals } from "@/lib/notifications/kinds";
import { paths } from "@/lib/notifications/links";

/**
 * Task notifications: the producer side of notifications v2, with the
 * original one-mail-per-event path kept as the fallback.
 *
 * Every function here builds the event once — who should hear about it,
 * what it is about, and how the immediate mail would look — and hands it to
 * `notify()`. With v2 recording, that creates the bell rows and decides
 * whether anything mails now, later (digest) or never. While v2 is not
 * delivering (env off, or shadow mode) `notify()` says `legacy: true` and
 * the code below sends exactly what it always sent.
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
  createdByUserId: true,
  jobId: true,
  leadId: true,
  violationCaseId: true,
  blocking: true,
  workflowTaskKey: true,
  sourceKey: true,
  inspectionResult: true,
  job: { select: { ...JOB_LABEL_SELECT, projectManagerId: true } },
  lead: { select: LEAD_LABEL_SELECT },
  violationCase: { select: { id: true, caseNumber: true, caseManagerId: true } },
  invoice: { select: { id: true, invoiceNumber: true, jobId: true } },
  estimate: { select: { id: true, estimateNumber: true, name: true, leadId: true } },
  prospect: { select: { id: true, propertyAddress1: true, city: true } },
  dailyLog: { select: { id: true, jobId: true, logDate: true } },
  assignedTo: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  completedBy: { select: { firstName: true, lastName: true } },
} as const;

type LoadedTask = TaskEmailTask & {
  assignedUserId: string | null;
  createdByUserId: string;
  jobId: string | null;
  leadId: string | null;
  violationCaseId: string | null;
  blocking: boolean;
  workflowTaskKey: string | null;
  sourceKey: string | null;
  inspectionResult: string | null;
  job: (TaskEmailTask["job"] & { id: string; projectManagerId: string | null }) | null;
  lead: (NonNullable<TaskEmailTask["lead"]> & { id: string }) | null;
  violationCase: { id: string; caseNumber: string; caseManagerId: string | null } | null;
  invoice: { id: string; invoiceNumber: string; jobId: string } | null;
  estimate: { id: string; estimateNumber: string; name: string; leadId: string } | null;
  prospect: { id: string; propertyAddress1: string; city: string } | null;
  dailyLog: { id: string; jobId: string; logDate: Date } | null;
};

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

// ─── v2 helpers ─────────────────────────────────────────────────────────────

function taskSubject(task: LoadedTask): NotifySubject {
  return { type: "task", id: task.id, taskId: task.id, jobId: task.jobId, leadId: task.leadId, violationCaseId: task.violationCaseId };
}

/** Made by an engine (workflow step, stage template, auto rule) rather than a person. */
function isEngineTask(task: LoadedTask): boolean {
  return Boolean(task.workflowTaskKey || task.sourceKey);
}

function taskSignals(task: LoadedTask): Signals {
  const r = task.inspectionResult;
  return {
    taskPriority: task.priority,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    blocking: task.blocking,
    inspectionResult: r === "PASS" || r === "FAIL" || r === "CONDITIONAL" ? r : null,
    engineTask: isEngineTask(task),
  };
}

/** The PM of the job / the case manager: told about engine work on their subject. */
function ownerCandidate(task: LoadedTask): Candidate | null {
  const owner = task.job?.projectManagerId ?? task.violationCase?.caseManagerId ?? null;
  return owner ? { userId: owner, reason: "owner" } : null;
}

function bodyLine(verb: string, task: LoadedTask): string {
  const where = subjectText(task);
  return where ? `${verb} · ${where}` : verb;
}

/**
 * The completion / blocked audience for v2: the assignee, watchers and —
 * for tasks a person raised — the raiser. Engine-made tasks drop the
 * raiser (the applier of a workflow would otherwise hear about every step)
 * and tell the subject's owner instead.
 */
function audienceFor(task: LoadedTask, audience: Candidate[]): Candidate[] {
  const engine = isEngineTask(task);
  const out = audience.filter((c) => !(engine && c.reason === "assignor"));
  const owner = ownerCandidate(task);
  if (owner) out.push(owner);
  return out;
}

// ─── legacy sender ──────────────────────────────────────────────────────────

/**
 * Render per recipient rather than once for everybody: the greeting is
 * personal and, more importantly, the CTA has to differ — a crew lead and an
 * office manager on the same completion mail need different destinations.
 */
async function dispatch(input: {
  taskId: string;
  /** Which notification this is, for the delivery-failure record. */
  kind: "assigned" | "completed" | "blocked" | "mention" | "nudged";
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
  const failures: DeliveryFailure[] = [];

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
      } else {
        // The provider accepted the call but handed back no message id (or
        // is unconfigured past the check above). That is a non-delivery, and
        // leaving it unrecorded is how "did he ever get told?" goes
        // unanswerable — the cron path already treats it as a failure.
        const reason = "email provider returned no message id";
        failures.push({ recipient: r.email, reason });
        await recordTaskEvent({
          taskId: input.taskId,
          actorUserId: input.actorUserId,
          type: "EMAIL_FAILED",
          toValue: r.email,
          body: reason,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown send error";
      failures.push({ recipient: r.email, reason });
      logger.exception(err, { where: "tasks.dispatch", taskId: input.taskId, to: r.email });
      await recordTaskEvent({
        taskId: input.taskId,
        actorUserId: input.actorUserId,
        type: "EMAIL_FAILED",
        toValue: r.email,
        body: reason,
      });
    }
  }

  // The timeline row above is visible only to someone who opens that task.
  // An unnotified assignee is precisely the person who will not open it, so
  // this also escalates through the normal delivery-failure channels.
  await reportDelivery({
    source: `tasks.${input.kind}`,
    attempted: input.recipients.length,
    sent,
    failures,
    context: { taskId: input.taskId },
  });

  return { sent, failed: failures.length };
}

function logSkips(taskId: string, kind: string, skipped: { userId: string; reason: string }[]) {
  const meaningful = skipped.filter((s) => s.reason !== "duplicate");
  if (meaningful.length > 0) {
    logger.info("task email recipients suppressed", { taskId, kind, skipped: meaningful });
  }
}

// ─── producers ──────────────────────────────────────────────────────────────

/**
 * New owner gets told. Self-assignment tells nobody. `readyStep` is a
 * workflow step that just became Ready (same message, its own kind, batched
 * per engine run); it has no legacy mail — the morning task digest always
 * covered Ready steps, and notifications v2 folds them into its digests.
 */
export async function notifyTaskAssigned(input: {
  taskId: string;
  actorUserId: string | null;
  reassigned?: boolean;
  batch?: NotifyBatch | null;
  readyStep?: boolean;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task) return;

  if (!task.assignedUserId) return;

  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();
  const render = (r: TaskRecipient, url: string) =>
    renderTaskAssignedEmail({
      task,
      recipientFirstName: r.firstName,
      actorName: name,
      url,
      brand,
      reassigned: input.reassigned,
    });

  const v2 = await notify({
    kind: input.readyStep ? "task.ready" : input.reassigned ? "task.reassigned" : "task.assigned",
    candidates: [{ userId: task.assignedUserId, reason: "assignee" }],
    actorUserId: input.actorUserId,
    subject: taskSubject(task),
    title: task.title,
    body: bodyLine(input.readyStep ? "Ready for you" : input.reassigned ? `Reassigned to you by ${name}` : `Assigned to you by ${name}`, task),
    href: paths.task(task.id),
    signals: taskSignals(task),
    batch: input.batch ?? null,
    immediateRender: render,
  });
  if (!v2.legacy) return;
  if (input.readyStep) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates: [{ userId: task.assignedUserId, reason: "assignee" }],
    suppressUserId: input.actorUserId,
  });
  logSkips(input.taskId, "assigned", skipped);

  await dispatch({
    taskId: input.taskId,
    kind: "assigned",
    recipients,
    actorUserId: input.actorUserId,
    render,
  });
}

/**
 * Completion closes the loop with everyone who was waiting: assignee,
 * assignor, watchers. In v2 the actor gets a bell receipt only, and the
 * raiser of an engine-made step is replaced by the subject's owner (the PM
 * or case manager) — see `audienceFor`. The legacy mail is unchanged: the
 * actor is NOT suppressed there, because a completion receipt was the
 * explicit requirement when it was built.
 */
export async function notifyTaskCompleted(input: {
  taskId: string;
  actorUserId: string | null;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task) return;

  const audience: Candidate[] = await taskAudience(input.taskId);

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
  const render = (r: TaskRecipient, url: string) =>
    renderTaskCompletedEmail({
      task,
      recipientFirstName: r.firstName,
      actorName: name,
      url,
      brand,
      notes,
    });

  const candidates = audienceFor(task, audience);
  if (input.actorUserId) candidates.push({ userId: input.actorUserId, reason: "actor" });
  const v2 = await notify({
    kind: "task.completed",
    candidates,
    actorUserId: input.actorUserId,
    suppressActor: false,
    subject: taskSubject(task),
    title: task.title,
    body: bodyLine(`Completed by ${name}`, task),
    href: paths.task(task.id),
    signals: taskSignals(task),
    immediateRender: render,
  });
  if (!v2.legacy) return;

  const { recipients, skipped } = await resolveRecipients({ candidates: audience });
  logSkips(input.taskId, "completed", skipped);

  await dispatch({
    taskId: input.taskId,
    kind: "completed",
    recipients,
    actorUserId: input.actorUserId,
    render,
  });
}

/** Blocked work needs the office to know, so this goes to the whole audience. */
export async function notifyTaskBlocked(input: {
  taskId: string;
  actorUserId: string | null;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task) return;

  const audience = await taskAudience(input.taskId);
  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();
  const render = (r: TaskRecipient, url: string) =>
    renderTaskBlockedEmail({
      task,
      recipientFirstName: r.firstName,
      actorName: name,
      url,
      brand,
    });

  const v2 = await notify({
    kind: "task.blocked",
    candidates: audienceFor(task, audience),
    actorUserId: input.actorUserId,
    subject: taskSubject(task),
    title: task.title,
    body: bodyLine(task.blockedReason ? `Blocked by ${name}: ${task.blockedReason}` : `Blocked by ${name}`, task),
    href: paths.task(task.id),
    signals: taskSignals(task),
    immediateRender: render,
  });
  if (!v2.legacy) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates: audience,
    suppressUserId: input.actorUserId,
  });
  logSkips(input.taskId, "blocked", skipped);

  await dispatch({
    taskId: input.taskId,
    kind: "blocked",
    recipients,
    actorUserId: input.actorUserId,
    render,
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

  const candidates = input.mentionedUserIds.map((userId) => ({ userId, reason: "mentioned" as const }));
  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();
  const render = (r: TaskRecipient, url: string) =>
    renderTaskMentionEmail({
      task,
      recipientFirstName: r.firstName,
      actorName: name,
      url,
      brand,
      note: input.note,
    });

  const v2 = await notify({
    kind: "task.mentioned",
    candidates,
    actorUserId: input.actorUserId,
    subject: taskSubject(task),
    title: task.title,
    body: `${input.note.authorName}: ${input.note.body.slice(0, 200)}`,
    href: paths.task(task.id),
    signals: taskSignals(task),
    immediateRender: render,
  });
  if (!v2.legacy) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates,
    suppressUserId: input.actorUserId,
  });
  logSkips(input.taskId, "mention", skipped);

  await dispatch({
    taskId: input.taskId,
    kind: "mention",
    recipients,
    actorUserId: input.actorUserId,
    render,
  });
}

/** "Where does this stand?" — assignee only, on the nudge channel. */
export async function notifyTaskNudged(input: {
  taskId: string;
  actorUserId: string;
  message?: string | null;
}): Promise<void> {
  const task = await loadTask(input.taskId);
  if (!task?.assignedUserId) return;

  const name = await actorName(input.actorUserId);
  const brand = await getEmailBrand();
  const render = (r: TaskRecipient, url: string) =>
    renderTaskNudgeEmail({
      task,
      recipientFirstName: r.firstName,
      actorName: name,
      url,
      brand,
      message: input.message,
    });

  const msg = input.message?.trim();
  const v2 = await notify({
    kind: "task.nudged",
    candidates: [{ userId: task.assignedUserId, reason: "assignee" }],
    actorUserId: input.actorUserId,
    subject: taskSubject(task),
    title: task.title,
    body: msg ? `${name} is checking in: ${msg.slice(0, 200)}` : `${name} is checking in on this task`,
    href: paths.task(task.id),
    signals: taskSignals(task),
    immediateRender: render,
  });
  if (!v2.legacy) return;

  const { recipients, skipped } = await resolveRecipients({
    candidates: [{ userId: task.assignedUserId, reason: "assignee" }],
    suppressUserId: input.actorUserId,
    channel: "nudge",
  });
  logSkips(input.taskId, "nudged", skipped);

  await dispatch({
    taskId: input.taskId,
    kind: "nudged",
    recipients,
    actorUserId: input.actorUserId,
    render,
  });
}
