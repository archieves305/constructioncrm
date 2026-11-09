import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { formatAddressLine } from "@/lib/labels/address";
import { appPathFor, chunk, isExpoPushToken, pushMessageFor, tokenIsDead } from "./push";

/**
 * Send phone pushes through Expo's push service, which hands them to Apple
 * (APNs) and Google (FCM). Best-effort and never throws: email and the bell
 * are unaffected by a failed push.
 *
 * Who gets one: the people given, with "Phone notifications" on, each phone
 * of theirs that has a push token, is not revoked and still holds a live
 * sign-in. A token Apple / Google no longer knows is cleared.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PushSubject = { taskId?: string | null; jobId?: string | null; leadId?: string | null };

/** The job's address line, from the task, the job or the lead. */
async function addressFor(subject: PushSubject): Promise<string | null> {
  const lead = { select: { propertyAddress1: true, propertyAddress2: true, city: true } } as const;
  if (subject.taskId) {
    const t = await prisma.task.findUnique({
      where: { id: subject.taskId },
      select: { job: { select: { lead } }, lead },
    });
    const l = t?.job?.lead ?? t?.lead;
    if (l) return formatAddressLine(l) || null;
  }
  if (subject.jobId) {
    const j = await prisma.job.findUnique({ where: { id: subject.jobId }, select: { lead } });
    if (j?.lead) return formatAddressLine(j.lead) || null;
  }
  if (subject.leadId) {
    const l = await prisma.lead.findUnique({ where: { id: subject.leadId }, select: lead.select });
    if (l) return formatAddressLine(l) || null;
  }
  return null;
}

export async function pushToUsers(input: {
  userIds: string[];
  kind: string;
  subject: PushSubject;
  /** Your own words instead of the kind's title and the address (the morning "my day" count). */
  text?: { title: string; body: string; path: string };
}): Promise<{ sent: number; cleared: number }> {
  try {
    if (input.userIds.length === 0) return { sent: 0, cleared: 0 };
    const devices = await prisma.mobileDevice.findMany({
      where: {
        userId: { in: input.userIds },
        user: { isActive: true, pushEnabled: true },
        revokedAt: null,
        pushToken: { not: null },
        tokens: { some: { endedAt: null } },
      },
      select: { id: true, pushToken: true },
    });
    const targets = devices.filter((d) => isExpoPushToken(d.pushToken));
    if (targets.length === 0) return { sent: 0, cleared: 0 };

    const message = input.text
      ? { title: input.text.title, body: input.text.body, data: { path: input.text.path } }
      : pushMessageFor(input.kind, await addressFor(input.subject), appPathFor(input.subject, input.kind));
    let sent = 0;
    let cleared = 0;
    for (const batch of chunk(targets)) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(
          batch.map((d) => ({ to: d.pushToken, title: message.title, body: message.body, data: message.data, sound: "default", priority: "high" })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn("push: Expo refused the batch", { status: res.status, kind: input.kind });
        continue;
      }
      const body = (await res.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } }[] } | null;
      const tickets = body?.data ?? [];
      for (let i = 0; i < batch.length; i++) {
        const ticket = tickets[i];
        if (ticket?.status === "ok") sent++;
        else if (ticket && tokenIsDead(ticket)) {
          await prisma.mobileDevice.update({ where: { id: batch[i].id }, data: { pushToken: null, pushTokenAt: null } });
          cleared++;
        } else if (ticket) {
          logger.warn("push: not delivered", { kind: input.kind, error: ticket.details?.error ?? ticket.status });
        }
      }
    }
    return { sent, cleared };
  } catch (err) {
    logger.exception(err, { where: "mobile.pushToUsers", kind: input.kind });
    return { sent: 0, cleared: 0 };
  }
}

/** The phone tells the CRM its push token (or null to stop). */
export async function setPushToken(tokenHash: string, pushToken: string | null): Promise<boolean> {
  const t = await prisma.mobileDeviceToken.findUnique({ where: { tokenHash }, select: { deviceId: true } });
  if (!t) return false;
  // One phone, one token: clear it anywhere else it is still recorded (a reinstall).
  if (pushToken) {
    await prisma.mobileDevice.updateMany({ where: { pushToken, id: { not: t.deviceId } }, data: { pushToken: null, pushTokenAt: null } });
  }
  await prisma.mobileDevice.update({
    where: { id: t.deviceId },
    data: { pushToken, pushTokenAt: pushToken ? new Date() : null },
  });
  return true;
}
