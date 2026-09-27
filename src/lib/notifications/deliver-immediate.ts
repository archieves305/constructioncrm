import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { reportDelivery } from "@/lib/email/delivery-report";
import { recordTaskEvent } from "@/lib/tasks/events";
import type { TaskRecipient } from "@/lib/tasks/recipients";
import type { RenderedEmail } from "@/lib/tasks/task-email";
import { urlForRole } from "./links";

/**
 * Send one IMMEDIATE notification now, with the caller's own renderer (the
 * existing task / case mails), and stamp the row. Best-effort: failures are
 * recorded on the row (the cron tick retries up to three times) and reported
 * through the normal delivery-failure channels.
 */

export type ImmediateAttachment = { filename: string; contentBase64: string };

export type ImmediateRender = (recipient: TaskRecipient, url: string) => RenderedEmail & { attachments?: ImmediateAttachment[] };

export async function deliverImmediate(input: {
  rowId: string;
  kind: string;
  recipient: TaskRecipient;
  href: string;
  render: ImmediateRender;
  taskId?: string | null;
  actorUserId: string | null;
}): Promise<boolean> {
  const url = urlForRole(input.href, input.recipient.role);
  const fail = async (reason: string) => {
    await prisma.notification.update({
      where: { id: input.rowId },
      data: { state: "FAILED", attempts: { increment: 1 }, lastError: reason.slice(0, 500) },
    });
    if (input.taskId) {
      await recordTaskEvent({ taskId: input.taskId, actorUserId: input.actorUserId, type: "EMAIL_FAILED", toValue: input.recipient.email, body: reason });
    }
    await reportDelivery({
      source: `notifications.immediate.${input.kind}`,
      attempted: 1,
      sent: 0,
      failures: [{ recipient: input.recipient.email, reason }],
      context: { notificationId: input.rowId },
    });
  };

  if (!isEmailConfigured()) {
    await prisma.notification.update({
      where: { id: input.rowId },
      data: { state: "FAILED", attempts: { increment: 1 }, lastError: "email provider not configured" },
    });
    logger.warn("immediate notification skipped: MailerSend not configured", { where: "notifications.deliverImmediate", kind: input.kind });
    return false;
  }

  try {
    const email = input.render(input.recipient, url);
    const result = await sendEmail({
      to: input.recipient.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments,
    });
    if (!result) {
      await fail("email provider returned no message id");
      return false;
    }
    const now = new Date();
    await prisma.notification.update({
      where: { id: input.rowId },
      data: { state: "SENT", emailedAt: now, providerMessageId: result.id, attempts: { increment: 1 }, lastError: null },
    });
    if (input.taskId) {
      await recordTaskEvent({ taskId: input.taskId, actorUserId: input.actorUserId, type: "EMAIL_SENT", toValue: input.recipient.email, body: email.subject });
    }
    await reportDelivery({ source: `notifications.immediate.${input.kind}`, attempted: 1, sent: 1, failures: [], context: { notificationId: input.rowId } });
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown send error";
    logger.exception(err, { where: "notifications.deliverImmediate", kind: input.kind, to: input.recipient.email });
    await fail(reason);
    return false;
  }
}
