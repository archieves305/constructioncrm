import { Prisma, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit/record";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { getEmailBrand, type EmailBrand } from "@/lib/email/brand";
import { renderEmailLayout } from "@/lib/email/layout";
import { escapeHtml } from "@/lib/email/escape";
import { formatAddressLine } from "@/lib/labels/address";
import { caseLabel } from "@/lib/labels/case";
import { jobLabel } from "@/lib/labels/job";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import { recordTaskEvent } from "@/lib/tasks/events";
import { retireReminders } from "@/lib/tasks/reminders";
import { localDateKey } from "@/lib/nurture/time";
import { paths, urlForRole } from "../links";
import { filterVisibleRows } from "../permissions";
import { isDeliveryTakenOver, loadNotificationSettings, windowSettingsOf, type NotificationSettingsRow } from "../settings";
import { dueWindow, nextWindow, slotOf, sortedWindows, type DigestWindow, type WindowSettings } from "../windows";
import { loadAgenda } from "./agenda";
import { buildDigest, type DigestModel, type DigestRowInput, type DigestSubject } from "./build";
import { digestSubject, renderDigestEmail } from "./render";

/**
 * The notifications tick (`POST /api/cron/notifications`, every 10 minutes).
 *
 * Shadow (env on, DB switch off): report only — what each person has
 * waiting for the due window. Takeover (both on): retry stuck IMMEDIATE
 * rows, then for the due window build and send one digest per person:
 * ledger row → atomic claim → permission re-check → pure build → render →
 * send → mark. The ledger's unique [recipient, window] is what stops a
 * digest going twice; a failed send releases its rows so nothing is lost.
 */

const IMMEDIATE_MAX_ATTEMPTS = 3;
const DIGEST_MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 2 * 60_000;
const STALE_SENDING_MS = 15 * 60_000;

export type DigestOutcome = "sent" | "skipped_empty" | "skipped_muted" | "failed" | "already" | "planned";

export type PerUserDigest = {
  userId: string;
  email: string;
  name: string;
  pending: number;
  kinds: Record<string, number>;
  outcome?: DigestOutcome;
  subject?: string | null;
  itemCount?: number;
  suppressed?: number;
  agendaItems?: number;
  error?: string | null;
};

export type TickResult = {
  recording: boolean;
  takeover: boolean;
  windowKey: string | null;
  nextWindowKey: string;
  immediates: { retried: number; sent: number; failures: DeliveryFailure[] };
  digest: { people: number; pending: number; sent: number; skippedEmpty: number; skippedMuted: number; failed: number; staleRecovered: number; perUser: PerUserDigest[] };
  morningProduced: boolean;
  pruned: number;
  dryRun: boolean;
};

const ZERO_DIGEST = (): TickResult["digest"] => ({ people: 0, pending: 0, sent: 0, skippedEmpty: 0, skippedMuted: 0, failed: 0, staleRecovered: 0, perUser: [] });

export async function runNotificationTick(now: Date, opts: { dryRun?: boolean } = {}): Promise<TickResult> {
  const dryRun = Boolean(opts.dryRun);
  const settings = await loadNotificationSettings();
  const takeover = isDeliveryTakenOver(settings);
  const ws = windowSettingsOf(settings);
  const due = dueWindow(now, ws);
  const next = nextWindow(now, ws);

  const immediates = takeover && !dryRun ? await retryImmediates(now) : { retried: 0, sent: 0, failures: [] };

  let digest = ZERO_DIGEST();
  let morningProduced = false;
  let pruned = 0;
  if (!takeover) {
    digest = await planDigests(due?.key ?? next.key);
  } else if (due) {
    const staleRecovered = dryRun ? 0 : await recoverStaleDigests(now);
    const isMorning = due.hhmm === sortedWindows(ws.digestWindows)[0];
    const isEvening = due.hhmm === sortedWindows(ws.digestWindows).at(-1);
    const today = localDateKey(now, ws.timeZone);
    digest = await runWindow(due, settings, ws, now, { dryRun, morning: isMorning });
    digest.staleRecovered = staleRecovered;
    if (isMorning && !dryRun && settings.lastMorningProducedOn !== today) {
      await prisma.notificationSettings.update({ where: { id: "default" }, data: { lastMorningProducedOn: today } });
      morningProduced = true;
    }
    if (isEvening && !dryRun) pruned = await prune(now, settings.retentionDays);
  }

  logger.info("notifications tick", {
    where: "cron.notifications",
    takeover,
    windowKey: due?.key ?? null,
    immediates: { retried: immediates.retried, sent: immediates.sent },
    digest: { people: digest.people, pending: digest.pending, sent: digest.sent, skippedEmpty: digest.skippedEmpty, failed: digest.failed },
    dryRun,
  });

  return { recording: true, takeover, windowKey: due?.key ?? null, nextWindowKey: next.key, immediates, digest, morningProduced, pruned, dryRun };
}

// ── Shadow: what would go ─────────────────────────────────────────────────

async function planDigests(windowKey: string): Promise<TickResult["digest"]> {
  const rows = await prisma.notification.findMany({
    where: { state: { in: ["PENDING", "SUPPRESSED"] }, deliveryClass: "DIGEST", scheduledWindowKey: { lte: windowKey } },
    select: { recipientUserId: true, kind: true, recipient: { select: { email: true, firstName: true, lastName: true } } },
  });
  const perUser = new Map<string, PerUserDigest>();
  for (const r of rows) {
    const u = perUser.get(r.recipientUserId) ?? { userId: r.recipientUserId, email: r.recipient.email, name: `${r.recipient.firstName} ${r.recipient.lastName}`.trim(), pending: 0, kinds: {} };
    u.pending++;
    u.kinds[r.kind] = (u.kinds[r.kind] ?? 0) + 1;
    perUser.set(r.recipientUserId, u);
  }
  return { ...ZERO_DIGEST(), people: perUser.size, pending: rows.length, perUser: Array.from(perUser.values()) };
}

// ── Takeover: the window ──────────────────────────────────────────────────

type RecipientRow = { id: string; email: string; firstName: string; lastName: string; isActive: boolean; digestWindows: string[]; notificationEmailMode: string; role: { name: RoleName } };

const RECIPIENT_SELECT = { id: true, email: true, firstName: true, lastName: true, isActive: true, digestWindows: true, notificationEmailMode: true, role: { select: { name: true } } } as const;

/**
 * Who gets a digest this window: everyone with pending rows, and — in the
 * morning — everyone who might have an agenda (a handful of staff; the
 * agenda loader decides per person and an empty one is skipped, not sent).
 */
async function recipientsFor(windowKey: string, morning: boolean): Promise<RecipientRow[]> {
  const pending = await prisma.notification.findMany({
    where: { state: "PENDING", deliveryClass: "DIGEST", scheduledWindowKey: { lte: windowKey } },
    select: { recipientUserId: true },
    distinct: ["recipientUserId"],
  });
  const ids = new Set(pending.map((p) => p.recipientUserId));
  const where: Prisma.UserWhereInput = morning
    ? { isActive: true, notificationEmailMode: { not: "IN_APP_ONLY" }, OR: [{ id: { in: Array.from(ids) } }, { role: { name: { in: ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "CREW_LEAD", "MARKETING"] } } }] }
    : { id: { in: Array.from(ids) } };
  return prisma.user.findMany({ where, select: RECIPIENT_SELECT, orderBy: { firstName: "asc" } });
}

async function runWindow(due: DigestWindow, settings: NotificationSettingsRow, ws: WindowSettings, now: Date, opts: { dryRun: boolean; morning: boolean }): Promise<TickResult["digest"]> {
  const out = ZERO_DIGEST();
  if (!opts.dryRun && !isEmailConfigured()) {
    logger.warn("notifications tick: email not configured, digests deferred", { where: "cron.notifications" });
    return out;
  }
  const recipients = await recipientsFor(due.key, opts.morning);
  const brand = await getEmailBrand();
  const failures: DeliveryFailure[] = [];
  for (const r of recipients) {
    const result = await processDigest(r, due, settings, ws, now, brand, opts.dryRun);
    out.perUser.push(result);
    out.pending += result.pending;
    if (result.outcome === "sent") out.sent++;
    else if (result.outcome === "skipped_empty") out.skippedEmpty++;
    else if (result.outcome === "skipped_muted") out.skippedMuted++;
    else if (result.outcome === "failed") {
      out.failed++;
      failures.push({ recipient: r.email, reason: result.error ?? "unknown" });
    }
  }
  out.people = out.perUser.filter((p) => p.outcome !== "already").length;
  if (!opts.dryRun && (out.sent + out.failed > 0)) {
    await reportDelivery({ source: "cron.notifications", attempted: out.sent + out.failed, sent: out.sent, failures, context: { windowKey: due.key, people: out.people } });
  }
  return out;
}

type ClaimedRow = Prisma.NotificationGetPayload<{ select: typeof ROW_SELECT }>;

const ROW_SELECT = {
  id: true, kind: true, title: true, body: true, href: true, priority: true, actionRequired: true, recipientReason: true,
  subjectType: true, subjectId: true, taskId: true, jobId: true, leadId: true, violationCaseId: true, batchKey: true, occurrences: true, lastOccurredAt: true,
  job: { select: JOB_LABEL_SELECT },
  violationCase: { select: { id: true, caseNumber: true, title: true, lead: { select: LEAD_LABEL_SELECT } } },
  lead: { select: LEAD_LABEL_SELECT },
} satisfies Prisma.NotificationSelect;

function subjectOf(r: ClaimedRow): DigestSubject {
  if (r.jobId && r.job) {
    const l = jobLabel(r.job, { customer: false });
    return { key: `job:${r.jobId}`, label: l.primary, code: l.code, href: paths.job(r.jobId) };
  }
  if (r.violationCaseId && r.violationCase) {
    const l = caseLabel(r.violationCase);
    return { key: `case:${r.violationCaseId}`, label: l.primary, code: l.code, href: paths.violationCase(r.violationCaseId) };
  }
  if (r.leadId && r.lead) {
    return { key: `lead:${r.leadId}`, label: formatAddressLine(r.lead) || r.lead.fullName, code: null, href: paths.lead(r.leadId) };
  }
  return { key: "none", label: "No job", code: null, href: null };
}

function toInput(r: ClaimedRow): DigestRowInput {
  return {
    id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, priority: r.priority, actionRequired: r.actionRequired, recipientReason: r.recipientReason,
    subjectType: r.subjectType, subjectId: r.subjectId, taskId: r.taskId, batchKey: r.batchKey, occurrences: r.occurrences, lastOccurredAt: r.lastOccurredAt, subject: subjectOf(r),
  };
}

function kindCounts(rows: { kind: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + 1;
  return out;
}

async function processDigest(r: RecipientRow, due: DigestWindow, settings: NotificationSettingsRow, ws: WindowSettings, now: Date, brand: EmailBrand, dryRun: boolean): Promise<PerUserDigest> {
  const user = { id: r.id, role: r.role.name };
  const base: PerUserDigest = { userId: r.id, email: r.email, name: `${r.firstName} ${r.lastName}`.trim(), pending: 0, kinds: {} };
  const pendingWhere: Prisma.NotificationWhereInput = { recipientUserId: r.id, state: "PENDING", deliveryClass: "DIGEST", scheduledWindowKey: { lte: due.key }, digestId: null };
  const slot = slotOf(due.hhmm, ws.digestWindows);

  // This person skips this window: their rows wait for the next one they want.
  const wanted = sortedWindows(r.digestWindows);
  if (wanted.length > 0 && !wanted.includes(due.hhmm)) {
    const pending = await prisma.notification.count({ where: pendingWhere });
    if (!dryRun && pending > 0) {
      const later = nextWindow(now, ws, r.digestWindows);
      await prisma.notification.updateMany({ where: pendingWhere, data: { scheduledWindowKey: later.key } });
      await prisma.notificationDigest.upsert({
        where: { recipientUserId_windowKey: { recipientUserId: r.id, windowKey: due.key } },
        create: { recipientUserId: r.id, windowKey: due.key, scheduledFor: due.scheduledFor, status: "SKIPPED_MUTED" },
        update: {},
      });
    }
    return { ...base, pending, outcome: "skipped_muted" };
  }

  // ── Dry run: build the model, claim nothing ──
  if (dryRun) {
    const rows = await prisma.notification.findMany({ where: pendingWhere, select: ROW_SELECT, take: 500 });
    const { visible, suppressed } = await filterVisibleRows(user, rows);
    const model = buildDigest(visible.map(toInput), { role: user.role, maxPerSection: settings.digestMaxPerSection, maxPerSubject: settings.digestMaxPerSubject, batchCollapseThreshold: settings.batchCollapseThreshold });
    const agenda = await loadAgenda(user, slot, now);
    const empty = model.itemCount === 0 && !agenda.model;
    return { ...base, pending: rows.length, kinds: kindCounts(rows), outcome: empty ? "skipped_empty" : "planned", subject: empty ? null : digestSubject(model, agenda.model, slot), itemCount: model.itemCount, suppressed: suppressed.length, agendaItems: agenda.model?.items.length ?? 0 };
  }

  // ── Ledger: one digest per person per window ──
  let ledger: { id: string; attempts: number; status: string; updatedAt: Date };
  try {
    ledger = await prisma.notificationDigest.create({ data: { recipientUserId: r.id, windowKey: due.key, scheduledFor: due.scheduledFor }, select: { id: true, attempts: true, status: true, updatedAt: true } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await prisma.notificationDigest.findUniqueOrThrow({ where: { recipientUserId_windowKey: { recipientUserId: r.id, windowKey: due.key } }, select: { id: true, attempts: true, status: true, updatedAt: true } });
    if (existing.status === "SENT" || existing.status === "SKIPPED_EMPTY" || existing.status === "SKIPPED_MUTED") return { ...base, outcome: "already" };
    if (existing.status === "SENDING") return { ...base, outcome: "already" }; // another tick has it (stale ones are recovered at the top of the tick)
    if (existing.status === "FAILED" && existing.attempts >= DIGEST_MAX_ATTEMPTS) return { ...base, outcome: "already", error: "gave up after 3 attempts; rows roll into the next window" };
    ledger = existing;
  }

  if (!r.isActive || !r.email) {
    await prisma.notificationDigest.update({ where: { id: ledger.id }, data: { status: "SKIPPED_MUTED", lastError: "recipient inactive or has no email" } });
    return { ...base, outcome: "skipped_muted", error: "recipient inactive or has no email" };
  }

  // ── Claim: atomic, so two overlapping ticks cannot both take a row ──
  await prisma.notification.updateMany({ where: pendingWhere, data: { digestId: ledger.id, state: "CLAIMED" } });
  const rows = await prisma.notification.findMany({ where: { digestId: ledger.id, state: "CLAIMED" }, select: ROW_SELECT, take: 500 });

  // ── Permission re-check ──
  const { visible, suppressed } = await filterVisibleRows(user, rows);
  if (suppressed.length > 0) {
    await prisma.notification.updateMany({ where: { id: { in: suppressed.map((s) => s.id) } }, data: { state: "SUPPRESSED", lastError: "no longer visible to the recipient at digest time" } });
  }

  const model = buildDigest(visible.map(toInput), { role: user.role, maxPerSection: settings.digestMaxPerSection, maxPerSubject: settings.digestMaxPerSubject, batchCollapseThreshold: settings.batchCollapseThreshold });
  const agenda = await loadAgenda(user, slot, now);
  const info: PerUserDigest = { ...base, pending: rows.length, kinds: kindCounts(rows), itemCount: model.itemCount, suppressed: suppressed.length, agendaItems: agenda.model?.items.length ?? 0 };

  // ── Nothing to say: the bell has it, no mail ──
  if (model.itemCount === 0 && !agenda.model) {
    await prisma.$transaction([
      prisma.notification.updateMany({ where: { digestId: ledger.id, state: "CLAIMED" }, data: { state: "SENT" } }),
      prisma.notificationDigest.update({ where: { id: ledger.id }, data: { status: "SKIPPED_EMPTY", itemCount: 0, suppressedCount: suppressed.length } }),
    ]);
    return { ...info, outcome: "skipped_empty" };
  }

  // ── Render + send ──
  const lastSent = await prisma.notificationDigest.findFirst({ where: { recipientUserId: r.id, status: "SENT", id: { not: ledger.id } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  const since = lastSent?.sentAt ?? new Date(now.getTime() - 24 * 3_600_000);
  const email = renderDigestEmail({ recipientFirstName: r.firstName, role: user.role, slot, model, agenda: agenda.model, since, brand });
  await prisma.notificationDigest.update({ where: { id: ledger.id }, data: { status: "SENDING", attempts: { increment: 1 }, subject: email.subject } });

  try {
    const result = await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
    if (!result) throw new Error("email provider returned no message id");
    const sentAt = new Date();
    await prisma.$transaction([
      prisma.notificationDigest.update({
        where: { id: ledger.id },
        data: { status: "SENT", sentAt, providerMessageId: result.id, lastError: null, itemCount: model.itemCount, collapsedCount: model.collapsedCount, hiddenCount: model.hiddenCount, suppressedCount: suppressed.length, sectionCounts: model.sectionCounts as Prisma.InputJsonValue },
      }),
      prisma.notification.updateMany({ where: { digestId: ledger.id, state: "CLAIMED" }, data: { state: "SENT", emailedAt: sentAt, providerMessageId: result.id } }),
    ]);
    await afterSend(visible, r, email.subject, sentAt, agenda.reminderTaskIds);
    return { ...info, outcome: "sent", subject: email.subject };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown send error";
    logger.exception(err, { where: "cron.notifications.digest", to: r.email, windowKey: due.key });
    // Release the rows: they retry within the window or roll into the next one. Never lost.
    await prisma.$transaction([
      prisma.notificationDigest.update({ where: { id: ledger.id }, data: { status: "FAILED", lastError: reason.slice(0, 500) } }),
      prisma.notification.updateMany({ where: { digestId: ledger.id, state: "CLAIMED" }, data: { state: "PENDING", digestId: null } }),
    ]);
    return { ...info, outcome: "failed", subject: email.subject, error: reason };
  }
}

/** Timeline receipts, once per task, and retire the reminders this digest carried. */
async function afterSend(rows: ClaimedRow[], r: RecipientRow, subject: string, sentAt: Date, reminderTaskIds: string[]): Promise<void> {
  const taskIds = Array.from(new Set(rows.flatMap((x) => (x.taskId ? [x.taskId] : []))));
  for (const taskId of taskIds) {
    try {
      await recordTaskEvent({ taskId, actorUserId: null, type: "EMAIL_SENT", toValue: r.email, body: subject });
    } catch (err) {
      logger.warn("digest receipt not recorded", { where: "cron.notifications.digest", taskId, err: err instanceof Error ? err.message : String(err) });
    }
  }
  if (reminderTaskIds.length) {
    try {
      await retireReminders(reminderTaskIds, sentAt, r.email);
    } catch (err) {
      logger.exception(err, { where: "cron.notifications.digest.retireReminders" });
    }
  }
}

/** A SENDING digest older than 15 minutes died mid-send: release its rows. A rare duplicate beats a lost digest. */
async function recoverStaleDigests(now: Date): Promise<number> {
  const stale = await prisma.notificationDigest.findMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } }, select: { id: true, recipientUserId: true, windowKey: true } });
  for (const d of stale) {
    await prisma.$transaction([
      prisma.notificationDigest.update({ where: { id: d.id }, data: { status: "FAILED", lastError: "stale SENDING: the tick died mid-send" } }),
      prisma.notification.updateMany({ where: { digestId: d.id, state: "CLAIMED" }, data: { state: "PENDING", digestId: null } }),
    ]);
    await recordAudit({ actorUserId: null, entityType: "NotificationDigest", entityId: d.id, action: "stale_recovery", after: { recipientUserId: d.recipientUserId, windowKey: d.windowKey } });
  }
  return stale.length;
}

/** Old delivered / suppressed rows and their digests, once a day. The bell only ever shows the recent past. */
async function prune(now: Date, retentionDays: number): Promise<number> {
  const before = new Date(now.getTime() - retentionDays * 86_400_000);
  const rows = await prisma.notification.deleteMany({ where: { createdAt: { lt: before }, state: { in: ["SENT", "SUPPRESSED"] } } });
  await prisma.notificationDigest.deleteMany({ where: { createdAt: { lt: before }, status: { in: ["SENT", "SKIPPED_EMPTY", "SKIPPED_MUTED"] } } });
  return rows.count;
}

// ── IMMEDIATE retries (unchanged from Stage 1) ────────────────────────────

async function retryImmediates(now: Date): Promise<TickResult["immediates"]> {
  const out: TickResult["immediates"] = { retried: 0, sent: 0, failures: [] };
  if (!isEmailConfigured()) return out;
  const rows = await prisma.notification.findMany({
    where: {
      deliveryClass: "IMMEDIATE",
      attempts: { lt: IMMEDIATE_MAX_ATTEMPTS },
      OR: [{ state: "PENDING", createdAt: { lte: new Date(now.getTime() - STUCK_AFTER_MS) } }, { state: "FAILED" }],
    },
    take: 50,
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, title: true, body: true, href: true, attempts: true, recipient: { select: { email: true, firstName: true, isActive: true, role: { select: { name: true } } } } },
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

/** For the admin page and tests: the model one person would get right now, without claiming. */
export type { DigestModel };
