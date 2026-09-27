import { Prisma, type DeliveryClass, type Priority } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { recordTaskEvent } from "@/lib/tasks/events";
import { resolveRecipients, type Candidate, type RecipientReason, type SkippedRecipient } from "@/lib/tasks/recipients";
import { classify, isActionRequired } from "./classify";
import { deliverImmediate, type ImmediateRender } from "./deliver-immediate";
import { KINDS, type NotificationKind, type Signals } from "./kinds";
import { classifySettingsOf, isDeliveryTakenOver, isNotificationsV2Recording, loadNotificationSettings, windowSettingsOf } from "./settings";
import { immediateCounts, stormActive } from "./storm";
import { dayBucket, hourBucket, nextWindow } from "./windows";

/**
 * The one way a staff-facing event becomes notifications.
 *
 *   event → notify() → one Notification row per recipient (the bell)
 *                    → classify: IMMEDIATE | DIGEST | IN_APP_ONLY | NONE
 *                    → IMMEDIATE sends now with the caller's renderer;
 *                      DIGEST waits for its window; IN_APP_ONLY just sits
 *                      in the bell.
 *
 * Gates (see settings.ts): with NOTIFICATIONS_V2 off this returns
 * `legacy: true` without touching the database and the caller mails the
 * way it always did. With the env flag on but the DB switch off (shadow),
 * rows are recorded and marked SUPPRESSED so nothing here sends while the
 * legacy path still does. With both on, v2 owns delivery.
 *
 * Never throws: the write that triggered it has already committed.
 */

export type NotifySubjectType =
  | "task"
  | "job"
  | "lead"
  | "violation_case"
  | "violation_item"
  | "case_inspection"
  | "case_hearing"
  | "daily_log"
  | "contract"
  | "none";

export type NotifySubject = {
  type: NotifySubjectType;
  /** The fine subject's id (item, inspection…); defaults to the matching typed id. */
  id?: string | null;
  taskId?: string | null;
  jobId?: string | null;
  leadId?: string | null;
  violationCaseId?: string | null;
};

/** Rows born from one engine run share a key; `size` is known up front so even the first row can be demoted. */
export type NotifyBatch = { key: string; size: number };

export type NotifyInput = {
  kind: NotificationKind;
  candidates: Candidate[];
  actorUserId: string | null;
  /** Default true. `false` keeps the actor as a bell-only receipt (reason "actor"). */
  suppressActor?: boolean;
  subject: NotifySubject;
  title: string;
  body?: string | null;
  /** Office path, no host. Role-specific links are resolved at render time. */
  href: string;
  signals?: Signals;
  priority?: Priority;
  batch?: NotifyBatch | null;
  forceClass?: DeliveryClass | null;
  occurredAt?: Date;
  /** Renders the immediate mail for one recipient (the existing task / case renderers). */
  immediateRender?: ImmediateRender;
  /** The caller already mailed this itself (grouped mails): record the row as delivered. */
  delivered?: { emailedAt: Date; providerMessageId?: string | null } | null;
};

export type NotifyRow = { id: string; userId: string; deliveryClass: DeliveryClass; created: boolean };

export type NotifyResult = {
  /** True when the caller must run its legacy mail path (v2 not recording, or shadow mode). */
  legacy: boolean;
  /** True when v2 owns delivery. */
  takeover: boolean;
  rows: NotifyRow[];
  skipped: SkippedRecipient[];
  deduped: number;
};

const LEGACY: NotifyResult = { legacy: true, takeover: false, rows: [], skipped: [], deduped: 0 };

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  if (!isNotificationsV2Recording()) return LEGACY;
  try {
    return await run(input);
  } catch (err) {
    logger.exception(err, { where: "notifications.notify", kind: input.kind, subject: input.subject });
    // The safest failure is "behave like before": the legacy mail still goes.
    return LEGACY;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function run(input: NotifyInput): Promise<NotifyResult> {
  const now = input.occurredAt ?? new Date();
  const settings = await loadNotificationSettings();
  const takeover = isDeliveryTakenOver(settings);
  const spec = KINDS[input.kind];
  const signals = input.signals ?? {};
  const suppress = input.suppressActor === false ? null : input.actorUserId;

  const { recipients, skipped } = await resolveRecipients({ candidates: input.candidates, suppressUserId: suppress, includeMuted: true });
  if (recipients.length === 0) return { legacy: !takeover, takeover, rows: [], skipped, deduped: 0 };

  const [counts, storm] = await Promise.all([
    immediateCounts(recipients.map((r) => r.userId), now),
    stormActive(settings, now),
  ]);
  const cs = classifySettingsOf(settings);
  const ws = windowSettingsOf(settings);
  const subjectId = input.subject.id ?? input.subject.taskId ?? input.subject.violationCaseId ?? input.subject.jobId ?? input.subject.leadId ?? null;

  const rows: NotifyRow[] = [];
  let deduped = 0;

  for (const r of recipients) {
    const reason: RecipientReason = input.actorUserId && r.userId === input.actorUserId ? "actor" : r.reason;
    const c = classify({
      kind: input.kind,
      reason,
      recipient: { role: r.role, emailAllowed: r.emailAllowed, emailMode: r.emailMode, mutedCategories: r.mutedCategories },
      signals,
      settings: cs,
      immediateCountLastHour: counts.get(r.userId) ?? 0,
      stormActive: storm,
      batchSize: input.batch?.size ?? 1,
      forceClass: input.forceClass ?? null,
      now,
      tz: settings.timeZone,
    });
    if (c.deliveryClass === "NONE") continue;

    let scheduledWindowKey: string | null = null;
    let bucket: string;
    if (c.deliveryClass === "DIGEST") {
      const w = nextWindow(now, ws, r.digestWindows);
      scheduledWindowKey = w.key;
      bucket = w.key;
    } else if (c.deliveryClass === "IMMEDIATE") {
      bucket = `imm:${hourBucket(now, settings.timeZone)}`;
    } else {
      bucket = `inapp:${dayBucket(now, settings.timeZone)}`;
    }
    const dedupeKey = `${input.kind}:${input.subject.type}:${subjectId ?? "-"}:${bucket}`;

    // IN_APP_ONLY rows are "delivered" by existing. Shadow-mode email rows
    // are SUPPRESSED so the tick never sends what the legacy path already did.
    const state = input.delivered
      ? "SENT"
      : c.deliveryClass === "IN_APP_ONLY"
        ? "SENT"
        : takeover
          ? "PENDING"
          : "SUPPRESSED";

    const data: Prisma.NotificationUncheckedCreateInput = {
      recipientUserId: r.userId,
      actorUserId: input.actorUserId,
      kind: input.kind,
      category: spec.category,
      recipientReason: reason,
      subjectType: input.subject.type,
      subjectId,
      taskId: input.subject.taskId ?? null,
      jobId: input.subject.jobId ?? null,
      leadId: input.subject.leadId ?? null,
      violationCaseId: input.subject.violationCaseId ?? null,
      title: input.title,
      body: input.body ?? null,
      href: input.href,
      priority: input.priority ?? signals.taskPriority ?? "MEDIUM",
      actionRequired: isActionRequired(input.kind, signals, reason),
      signals: signals as Prisma.InputJsonValue,
      batchKey: input.batch?.key ?? null,
      dedupeKey,
      lastOccurredAt: now,
      deliveryClass: c.deliveryClass,
      classifyReason: c.reason,
      demotedFrom: c.demotedFrom ?? null,
      demotedReason: c.demotedReason ?? null,
      scheduledWindowKey,
      state,
      lastError: !takeover && state === "SUPPRESSED" ? "shadow: legacy path mailed" : null,
      emailedAt: input.delivered?.emailedAt ?? null,
      providerMessageId: input.delivered?.providerMessageId ?? null,
    };

    let id: string;
    let created = true;
    try {
      const row = await prisma.notification.create({ data, select: { id: true } });
      id = row.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Same event, same subject, same window: one row, counted twice, unread again.
      const row = await prisma.notification.update({
        where: { recipientUserId_dedupeKey: { recipientUserId: r.userId, dedupeKey } },
        data: {
          occurrences: { increment: 1 },
          lastOccurredAt: now,
          title: input.title,
          body: input.body ?? null,
          signals: signals as Prisma.InputJsonValue,
          actorUserId: input.actorUserId,
          priority: data.priority,
          readAt: null,
        },
        select: { id: true },
      });
      id = row.id;
      created = false;
      deduped++;
    }
    rows.push({ id, userId: r.userId, deliveryClass: c.deliveryClass, created });

    if (created && input.subject.taskId) {
      await recordTaskEvent({
        taskId: input.subject.taskId,
        actorUserId: input.actorUserId,
        type: "NOTIFIED",
        toValue: r.userId,
        body: `${input.kind} → ${c.deliveryClass}${c.demotedReason ? ` (${c.demotedReason})` : ""}`,
      });
    }

    if (created && takeover && c.deliveryClass === "IMMEDIATE" && !input.delivered && input.immediateRender) {
      await deliverImmediate({
        rowId: id,
        kind: input.kind,
        recipient: r,
        href: input.href,
        render: input.immediateRender,
        taskId: input.subject.taskId ?? null,
        actorUserId: input.actorUserId,
      });
    }
  }

  if (skipped.some((s) => s.reason !== "duplicate")) {
    logger.info("notification recipients suppressed", { where: "notifications.notify", kind: input.kind, skipped: skipped.filter((s) => s.reason !== "duplicate") });
  }

  return { legacy: !takeover, takeover, rows, skipped, deduped };
}
