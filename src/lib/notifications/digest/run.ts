import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { renderEmailLayout } from "@/lib/email/layout";
import { escapeHtml } from "@/lib/email/escape";
import { isDeliveryTakenOver, loadNotificationSettings, windowSettingsOf } from "../settings";
import { dueWindow, nextWindow } from "../windows";
import { urlForRole } from "../links";

/**
 * The notifications tick (`POST /api/cron/notifications`, every 10 minutes).
 *
 * Stage 1 scope: retry IMMEDIATE rows that never went out, and report what
 * the due digest window would contain per person. Digest building and
 * sending arrive in Stage 2; until then the tick never claims DIGEST rows,
 * so nothing here can send twice what the legacy path already sent.
 */

const IMMEDIATE_MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 2 * 60_000;

export type TickResult = {
  recording: boolean;
  takeover: boolean;
  windowKey: string | null;
  nextWindowKey: string;
  immediates: { retried: number; sent: number; failures: DeliveryFailure[] };
  digest: { people: number; pending: number; perUser: { userId: string; email: string; pending: number; kinds: Record<string, number> }[] };
  dryRun: boolean;
};

export async function runNotificationTick(now: Date, opts: { dryRun?: boolean } = {}): Promise<TickResult> {
  const settings = await loadNotificationSettings();
  const takeover = isDeliveryTakenOver(settings);
  const ws = windowSettingsOf(settings);
  const due = dueWindow(now, ws);
  const next = nextWindow(now, ws);

  const immediates = takeover && !opts.dryRun ? await retryImmediates(now) : { retried: 0, sent: 0, failures: [] };
  const digest = await planDigests(due?.key ?? next.key);

  logger.info("notifications tick", { where: "cron.notifications", takeover, windowKey: due?.key ?? null, immediates: { retried: immediates.retried, sent: immediates.sent }, people: digest.people, pending: digest.pending, dryRun: Boolean(opts.dryRun) });

  return {
    recording: true,
    takeover,
    windowKey: due?.key ?? null,
    nextWindowKey: next.key,
    immediates,
    digest,
    dryRun: Boolean(opts.dryRun),
  };
}

/** What each person has waiting for the given window or earlier. Read-only. */
async function planDigests(windowKey: string): Promise<TickResult["digest"]> {
  const rows = await prisma.notification.findMany({
    where: { state: "PENDING", deliveryClass: "DIGEST", scheduledWindowKey: { lte: windowKey } },
    select: { recipientUserId: true, kind: true, recipient: { select: { email: true } } },
  });
  const perUser = new Map<string, { userId: string; email: string; pending: number; kinds: Record<string, number> }>();
  for (const r of rows) {
    const u = perUser.get(r.recipientUserId) ?? { userId: r.recipientUserId, email: r.recipient.email, pending: 0, kinds: {} };
    u.pending++;
    u.kinds[r.kind] = (u.kinds[r.kind] ?? 0) + 1;
    perUser.set(r.recipientUserId, u);
  }
  return { people: perUser.size, pending: rows.length, perUser: Array.from(perUser.values()) };
}

/**
 * IMMEDIATE rows still PENDING after a couple of minutes (an `after()` that
 * died with the process) or FAILED under the attempt cap get one more try
 * with a generic single-item mail. The caller's renderer is gone by now;
 * the row carries enough to say what happened and where to go.
 */
async function retryImmediates(now: Date): Promise<TickResult["immediates"]> {
  const out: TickResult["immediates"] = { retried: 0, sent: 0, failures: [] };
  if (!isEmailConfigured()) return out;
  const rows = await prisma.notification.findMany({
    where: {
      deliveryClass: "IMMEDIATE",
      attempts: { lt: IMMEDIATE_MAX_ATTEMPTS },
      OR: [
        { state: "PENDING", createdAt: { lte: new Date(now.getTime() - STUCK_AFTER_MS) } },
        { state: "FAILED" },
      ],
    },
    take: 50,
    orderBy: { createdAt: "asc" },
    select: {
      id: true, kind: true, title: true, body: true, href: true, attempts: true,
      recipient: { select: { email: true, firstName: true, isActive: true, role: { select: { name: true } } } },
    },
  });
  if (rows.length === 0) return out;
  const brand = await getEmailBrand();
  for (const r of rows) {
    out.retried++;
    if (!r.recipient.isActive || !r.recipient.email) {
      await prisma.notification.update({ where: { id: r.id }, data: { state: "SUPPRESSED", lastError: "recipient inactive or has no email" } });
      continue;
    }
    const url = urlForRole(r.href, r.recipient.role.name);
    const bodyHtml = `<p>Hi ${escapeHtml(r.recipient.firstName)},</p><p><strong>${escapeHtml(r.title)}</strong></p>${r.body ? `<p>${escapeHtml(r.body)}</p>` : ""}<p><a href="${escapeHtml(url)}" style="display:inline-block;background:${escapeHtml(brand.primaryColor)};color:#fff;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none">Open in the CRM</a></p>`;
    const bodyText = `Hi ${r.recipient.firstName},\n\n${r.title}${r.body ? `\n${r.body}` : ""}\n\nOpen: ${url}`;
    const { html, text } = renderEmailLayout({ bodyHtml, bodyText, brand });
    try {
      const result = await sendEmail({ to: r.recipient.email, subject: r.title, html, text });
      if (result) {
        out.sent++;
        await prisma.notification.update({ where: { id: r.id }, data: { state: "SENT", emailedAt: new Date(), providerMessageId: result.id, attempts: { increment: 1 }, lastError: null } });
      } else {
        out.failures.push({ recipient: r.recipient.email, reason: "email provider returned no message id" });
        await prisma.notification.update({ where: { id: r.id }, data: { state: "FAILED", attempts: { increment: 1 }, lastError: "email provider returned no message id" } });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown send error";
      out.failures.push({ recipient: r.recipient.email, reason });
      await prisma.notification.update({ where: { id: r.id }, data: { state: "FAILED", attempts: { increment: 1 }, lastError: reason.slice(0, 500) } });
    }
  }
  await reportDelivery({ source: "cron.notifications.immediate-retry", attempted: out.retried, sent: out.sent, failures: out.failures });
  return out;
}
