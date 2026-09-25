// The daily nurture tick. Loads, asks the pure planner, sends, writes. Every
// phase is fenced; `dryRun` performs the whole plan in memory and writes
// nothing, so the first day can be inspected before anything goes out.

import { Prisma } from "@/generated/prisma/client";
import type { NurtureContentKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getEmailBrand } from "@/lib/email/brand";
import { reportDelivery, type DeliveryFailure } from "@/lib/email/delivery-report";
import { renderLeadEmail, type LeadTemplateContext } from "@/lib/email/render-template";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { renderTemplate } from "@/lib/templates/render";
import { closeAutoTask, ensureAutoTask, sourceKeyFor } from "@/lib/tasks/auto-tasks";
import { cadenceOf, loadNurtureSettings } from "./settings";
import { decideAction, initialState, shouldPromptRep, stateAfterReanchor, stateAfterSend, type AnchorEvent, type PlannableState } from "./plan";
import { hoursBetween, slotKeyFor } from "./time";

export type PlannedSend = {
  leadId: string;
  leadName: string;
  email: string | null;
  rep: string | null;
  kind: "FOLLOW_UP" | "NURTURE" | "SKIP" | "PROMPT_REP" | "STOP" | "PAUSE" | "RESUME" | "NONE";
  subject: string | null;
  reason: string;
};

export type NurtureRunResult = {
  enabled: boolean;
  envEnabled: boolean;
  settingsEnabled: boolean;
  emailConfigured: boolean;
  dryRun: boolean;
  enrolled: number;
  stopped: number;
  paused: number;
  resumed: number;
  touchesSynced: number;
  due: number;
  planned: number;
  sent: number;
  skipped: number;
  failed: number;
  prompts: number;
  failures: string[];
  plan: PlannedSend[];
};

const CONSECUTIVE_FAILURES_TO_PAUSE = 3;

const LEAD_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  fullName: true,
  primaryPhone: true,
  email: true,
  city: true,
  propertyAddress1: true,
  companyName: true,
  emailOptedOut: true,
  assignedUserId: true,
  createdByUserId: true,
  createdAt: true,
  currentStage: { select: { id: true, name: true, isClosed: true, isWon: true, isLost: true } },
  assignedUser: { select: { id: true, firstName: true, lastName: true, email: true, signatureHtml: true, signatureText: true } },
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_SELECT }>;

function plannable(lead: LeadRow) {
  return { email: lead.email, emailOptedOut: lead.emailOptedOut, stageId: lead.currentStage.id, stageIsClosed: lead.currentStage.isClosed, stageIsWon: lead.currentStage.isWon, stageIsLost: lead.currentStage.isLost };
}

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

async function anchorEventsFor(leads: LeadRow[]): Promise<Map<string, AnchorEvent[]>> {
  const ids = leads.map((l) => l.id);
  const out = new Map<string, AnchorEvent[]>();
  for (const l of leads) out.set(l.id, [{ kind: "created", at: l.createdAt }]);
  if (ids.length === 0) return out;
  const [history, estimates, contracts, comms] = await Promise.all([
    prisma.leadStageHistory.findMany({ where: { leadId: { in: ids } }, orderBy: { changedAt: "desc" }, distinct: ["leadId"], select: { leadId: true, changedAt: true, toStage: { select: { name: true } } } }),
    prisma.estimate.findMany({ where: { leadId: { in: ids }, status: "SENT" }, orderBy: { updatedAt: "desc" }, distinct: ["leadId"], select: { leadId: true, updatedAt: true } }),
    prisma.customerContract.findMany({ where: { leadId: { in: ids }, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, distinct: ["leadId"], select: { leadId: true, sentAt: true } }),
    prisma.communication.findMany({
      where: { leadId: { in: ids }, OR: [{ createdByUserId: { not: null } }, { direction: "INBOUND" }] },
      orderBy: { createdAt: "desc" },
      distinct: ["leadId"],
      select: { leadId: true, createdAt: true, sentAt: true, receivedAt: true, communicationType: true },
    }),
  ]);
  for (const h of history) out.get(h.leadId)?.push({ kind: "stage_change", at: h.changedAt, detail: h.toStage.name });
  for (const e of estimates) out.get(e.leadId)?.push({ kind: "estimate_sent", at: e.updatedAt });
  for (const c of contracts) if (c.sentAt) out.get(c.leadId)?.push({ kind: "contract_sent", at: c.sentAt });
  for (const c of comms) out.get(c.leadId)?.push({ kind: "personal_touch", at: c.receivedAt ?? c.sentAt ?? c.createdAt, detail: c.communicationType.toLowerCase() });
  return out;
}

async function latestAutomatedEmailAt(leadIds: string[]): Promise<Map<string, Date>> {
  if (leadIds.length === 0) return new Map();
  const rows = await prisma.communication.findMany({
    where: { leadId: { in: leadIds }, communicationType: "EMAIL", direction: "OUTBOUND", createdByUserId: null },
    orderBy: { createdAt: "desc" },
    distinct: ["leadId"],
    select: { leadId: true, sentAt: true, createdAt: true },
  });
  return new Map(rows.map((r) => [r.leadId, r.sentAt ?? r.createdAt]));
}

function templateContext(lead: LeadRow): LeadTemplateContext {
  return {
    lead: {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      fullName: lead.fullName,
      primaryPhone: lead.primaryPhone,
      email: lead.email ?? "",
      city: lead.city ?? "",
      addressLine1: lead.propertyAddress1 ?? "",
    },
    assignedTo: {
      firstName: lead.assignedUser?.firstName ?? "",
      lastName: lead.assignedUser?.lastName ?? "",
      signatureHtml: lead.assignedUser?.signatureHtml ?? null,
      signatureText: lead.assignedUser?.signatureText ?? null,
    },
    company: { name: lead.companyName ?? "" },
  };
}

async function fallbackActor(): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return u?.id ?? null;
}

export async function runNurtureTick(now: Date = new Date(), opts: { dryRun?: boolean; limit?: number } = {}): Promise<NurtureRunResult> {
  const dryRun = Boolean(opts.dryRun);
  const settingsRow = await loadNurtureSettings();
  const s = cadenceOf(settingsRow);
  const envEnabled = env.NURTURE_ENABLED === "1";
  const emailConfigured = isEmailConfigured();
  const result: NurtureRunResult = {
    enabled: envEnabled && settingsRow.enabled,
    envEnabled,
    settingsEnabled: settingsRow.enabled,
    emailConfigured,
    dryRun,
    enrolled: 0,
    stopped: 0,
    paused: 0,
    resumed: 0,
    touchesSynced: 0,
    due: 0,
    planned: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    prompts: 0,
    failures: [],
    plan: [],
  };
  // A dry run always plans; a live run needs both gates.
  if (!dryRun && !result.enabled) return result;
  const limit = opts.limit ?? (Number(env.NURTURE_MAX_PER_RUN) || 50);

  type LiveState = Prisma.LeadNurtureStateGetPayload<{ include: { lead: { select: typeof LEAD_SELECT } } }>;
  const virtual: LiveState[] = [];

  // 1. Enrol open leads with an email that have no state yet.
  try {
    const fresh = await prisma.lead.findMany({
      where: { email: { not: null }, emailOptedOut: false, currentStage: { isClosed: false }, nurtureState: null },
      select: LEAD_SELECT,
      take: 500,
    });
    const events = await anchorEventsFor(fresh);
    const rows = fresh
      .filter((l) => l.email?.trim())
      .map((l) => ({ leadId: l.id, ...initialState(events.get(l.id) ?? [{ kind: "created", at: l.createdAt }], now, s, { excludedStage: s.excludedStageIds.includes(l.currentStage.id) }) }));
    result.enrolled = rows.length;
    if (!dryRun && rows.length > 0) await prisma.leadNurtureState.createMany({ data: rows, skipDuplicates: true });
    if (dryRun) {
      // Plan them as if enrolled, so a preview on day one shows what the live run would send.
      for (const row of rows) {
        const lead = fresh.find((l) => l.id === row.leadId);
        if (lead) virtual.push({ id: `dry:${row.leadId}`, stoppedReason: null, pausedByUserId: null, lastFollowUpAt: null, lastNurtureAt: null, lastAutoEmailAt: null, repPromptedAt: null, stepsExhaustedNotifiedAt: null, nurtureExhaustedAt: null, updatedAt: now, ...row, lead });
      }
    }
  } catch (err) {
    logger.exception(err, { where: "nurture.enrol" });
  }

  // 2. Reconcile every live state against its lead (the backstop for writes that bypass the hooks).
  const live = [
    ...(await prisma.leadNurtureState.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      include: { lead: { select: LEAD_SELECT } },
    })),
    ...virtual,
  ];
  const keep: typeof live = [];
  for (const st of live) {
    const d = decideAction({ lead: plannable(st.lead), state: st as PlannableState, now, s, lastAutomatedEmailAt: null, unsentNurtureCount: 1 });
    try {
      if (d.kind === "stop") {
        result.stopped++;
        result.plan.push({ leadId: st.leadId, leadName: st.lead.fullName, email: st.lead.email, rep: null, kind: "STOP", subject: null, reason: d.reason });
        if (!dryRun) {
          await prisma.leadNurtureState.update({ where: { id: st.id }, data: { status: "STOPPED", stoppedReason: d.reason, nextFollowUpAt: null, nextNurtureAt: null } });
          await closeAutoTask(sourceKeyFor({ kind: "nurture.personal-touch", leadId: st.leadId }), { actorUserId: null, outcome: "CANCELLED", because: `lead ${d.reason}` });
        }
        continue;
      }
      if (d.kind === "pause") {
        result.paused++;
        result.plan.push({ leadId: st.leadId, leadName: st.lead.fullName, email: st.lead.email, rep: null, kind: "PAUSE", subject: null, reason: d.reason });
        if (!dryRun) await prisma.leadNurtureState.update({ where: { id: st.id }, data: { status: "PAUSED", pausedReason: d.reason } });
        continue;
      }
      if (d.kind === "resume") {
        result.resumed++;
        result.plan.push({ leadId: st.leadId, leadName: st.lead.fullName, email: st.lead.email, rep: null, kind: "RESUME", subject: null, reason: "stage no longer excluded" });
        if (!dryRun) await prisma.leadNurtureState.update({ where: { id: st.id }, data: { status: "ACTIVE", pausedReason: null } });
        keep.push({ ...st, status: "ACTIVE" });
        continue;
      }
      if (st.status === "ACTIVE") keep.push(st);
    } catch (err) {
      logger.exception(err, { where: "nurture.reconcile", leadId: st.leadId });
    }
  }

  // 3. Sync personal touches that arrived without a hook.
  try {
    const ids = keep.map((k) => k.leadId);
    if (ids.length > 0) {
      const latest = await prisma.communication.findMany({
        where: { leadId: { in: ids }, OR: [{ createdByUserId: { not: null } }, { direction: "INBOUND" }] },
        orderBy: { createdAt: "desc" },
        distinct: ["leadId"],
        select: { leadId: true, createdAt: true, sentAt: true, receivedAt: true, communicationType: true },
      });
      for (const c of latest) {
        const st = keep.find((k) => k.leadId === c.leadId);
        if (!st) continue;
        const at = c.receivedAt ?? c.sentAt ?? c.createdAt;
        if (st.lastPersonalTouchAt && st.lastPersonalTouchAt.getTime() >= at.getTime()) continue;
        result.touchesSynced++;
        const patch = { ...stateAfterReanchor(st as PlannableState, at, `personal_touch:${c.communicationType.toLowerCase()}`, { resetStep: false, nurtureExhausted: Boolean(st.nurtureExhaustedAt) }, s), lastPersonalTouchAt: at, repPromptedAt: null };
        Object.assign(st, patch);
        if (!dryRun) {
          await prisma.leadNurtureState.update({ where: { id: st.id }, data: patch });
          await closeAutoTask(sourceKeyFor({ kind: "nurture.personal-touch", leadId: st.leadId }), { actorUserId: null, outcome: "CANCELLED", because: "personal touch logged" });
        }
      }
    }
  } catch (err) {
    logger.exception(err, { where: "nurture.syncTouches" });
  }

  // 4. Due states, capped; the earliest of the two dates first.
  const due = keep
    .filter((k) => (k.nextFollowUpAt && k.nextFollowUpAt <= now) || (k.nextNurtureAt && k.nextNurtureAt <= now))
    .sort((a, b) => Math.min(a.nextFollowUpAt?.getTime() ?? Infinity, a.nextNurtureAt?.getTime() ?? Infinity) - Math.min(b.nextFollowUpAt?.getTime() ?? Infinity, b.nextNurtureAt?.getTime() ?? Infinity));
  result.due = due.length;
  const batch = due.slice(0, limit);
  const lastAuto = await latestAutomatedEmailAt(batch.map((b) => b.leadId));
  const [content, sentNurture, recentByEmail] = await Promise.all([
    prisma.nurtureContent.findMany({ where: { isActive: true }, orderBy: [{ kind: "asc" }, { step: "asc" }, { sortOrder: "asc" }] }),
    prisma.leadNurtureSend.findMany({ where: { leadId: { in: batch.map((b) => b.leadId) }, kind: "NURTURE", status: "SENT" }, select: { leadId: true, contentId: true } }),
    batch.length > 0
      ? prisma.leadNurtureSend.findMany({ where: { toEmail: { in: [...new Set(batch.map((b) => normEmail(b.lead.email ?? "")).filter(Boolean))] }, status: "SENT", sentAt: { gte: new Date(now.getTime() - s.minGapHours * 3_600_000) } }, select: { toEmail: true, sentAt: true } })
      : Promise.resolve([]),
  ]);
  const followUps = content.filter((c) => c.kind === "FOLLOW_UP" && c.step != null).sort((a, b) => a.step! - b.step!);
  const nurture = content.filter((c) => c.kind === "NURTURE");
  const sentByLead = new Map<string, Set<string>>();
  for (const r of sentNurture) {
    if (!r.contentId) continue;
    if (!sentByLead.has(r.leadId)) sentByLead.set(r.leadId, new Set());
    sentByLead.get(r.leadId)!.add(r.contentId);
  }
  const emailSeenThisRun = new Set<string>();
  const recentEmails = new Set(recentByEmail.map((r) => normEmail(r.toEmail)));
  const brand = emailConfigured || dryRun ? await getEmailBrand().catch(() => null) : null;
  const failures: DeliveryFailure[] = [];

  // 5. Act.
  for (const st of batch) {
    const lead = st.lead;
    const email = lead.email ? normEmail(lead.email) : "";
    const unsent = nurture.filter((c) => !sentByLead.get(st.leadId)?.has(c.id));
    const lastAutomatedEmailAt = [st.lastAutoEmailAt, lastAuto.get(st.leadId) ?? null].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const d = decideAction({ lead: plannable(lead), state: st as PlannableState, now, s, lastAutomatedEmailAt, unsentNurtureCount: unsent.length });
    const rep = lead.assignedUser ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}` : null;
    const push = (kind: PlannedSend["kind"], subject: string | null, reason: string) => result.plan.push({ leadId: st.leadId, leadName: lead.fullName, email: lead.email, rep, kind, subject, reason });

    try {
      if (d.kind === "none") {
        push("NONE", null, d.reason);
        continue;
      }
      if (d.kind === "nurture_exhausted") {
        push("NONE", null, "nurture library exhausted");
        if (!dryRun) await prisma.leadNurtureState.update({ where: { id: st.id }, data: { nurtureExhaustedAt: now, nextNurtureAt: null } });
        continue;
      }
      if (d.kind === "skip_follow_up") {
        result.skipped++;
        push("SKIP", null, `personal touch within ${s.personalTouchSkipDays} days`);
        if (!dryRun) {
          const patch = stateAfterSend(st as PlannableState, "FOLLOW_UP", now, s, { skipped: true, nurtureExhausted: Boolean(st.nurtureExhaustedAt) });
          await prisma.leadNurtureState.update({ where: { id: st.id }, data: patch });
          await prisma.leadNurtureSend.create({
            data: { leadId: st.leadId, stateId: st.id, kind: "FOLLOW_UP", step: d.step + 1, slotKey: slotKeyFor("FOLLOW_UP", now, s.timeZone), scheduledFor: st.nextFollowUpAt ?? now, status: "SKIPPED", error: `personal touch within ${s.personalTouchSkipDays} days`, subject: "", toEmail: lead.email ?? "" },
          }).catch(() => undefined);
        }
        continue;
      }
      if (d.kind !== "follow_up" && d.kind !== "nurture") continue;

      // Same address twice in one run (family, landlord): the second waits.
      if (email && (emailSeenThisRun.has(email) || recentEmails.has(email))) {
        push("NONE", null, "same email address already mailed within the gap");
        continue;
      }

      const kind: NurtureContentKind = d.kind === "follow_up" ? "FOLLOW_UP" : "NURTURE";
      const stepNo = d.kind === "follow_up" ? d.step + 1 : null;
      const piece = kind === "FOLLOW_UP" ? (followUps.find((c) => c.step === stepNo) ?? followUps.at(-1)) : unsent[0];
      if (!piece) {
        push("NONE", null, kind === "FOLLOW_UP" ? "no active follow-up template" : "no nurture content");
        continue;
      }
      result.planned++;
      const ctx = templateContext(lead);
      const subject = renderTemplate(piece.subject, { ...ctx, company: { ...ctx.company, brand: brand?.companyName ?? "" } });
      push(kind, subject, kind === "FOLLOW_UP" ? `follow-up step ${stepNo}` : `nurture slot ${st.nurtureSlot + 1}`);
      emailSeenThisRun.add(email);
      if (dryRun) continue;

      if (!emailConfigured || !brand) {
        result.failed++;
        failures.push({ recipient: lead.email ?? "", reason: "email provider not configured" });
        continue;
      }

      // The send row first: a duplicate slot means this already ran today.
      const slotKey = slotKeyFor(kind, now, s.timeZone);
      let sendRow: { id: string };
      try {
        sendRow = await prisma.leadNurtureSend.create({
          data: { leadId: st.leadId, stateId: st.id, kind, contentId: piece.id, step: stepNo, slotKey, scheduledFor: (kind === "FOLLOW_UP" ? st.nextFollowUpAt : st.nextNurtureAt) ?? now, status: "FAILED", error: "in flight", subject, toEmail: lead.email! },
          select: { id: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          result.plan.pop();
          result.planned--;
          push("NONE", subject, "slot already used today");
          continue;
        }
        throw err;
      }

      const rendered = renderLeadEmail({ templateBody: piece.body, context: ctx, brand, includeUnsubscribe: true });
      let externalMessageId: string | null = null;
      try {
        const r = await sendEmail({
          to: lead.email!,
          subject,
          html: rendered.html,
          text: rendered.text,
          replyTo: lead.assignedUser?.email ?? undefined,
          // No List-Unsubscribe headers: MailerSend rejects custom headers below the
          // Professional plan (422, seen on dev 2026-09-25). The body carries the link.
        });
        if (!r) throw new Error("email provider not configured");
        externalMessageId = r.id;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "send failed";
        result.failed++;
        failures.push({ recipient: lead.email ?? "", reason });
        await prisma.leadNurtureSend.update({ where: { id: sendRow.id }, data: { error: reason } });
        const recentFails = await prisma.leadNurtureSend.findMany({ where: { leadId: st.leadId, kind }, orderBy: { createdAt: "desc" }, take: CONSECUTIVE_FAILURES_TO_PAUSE, select: { status: true } });
        if (recentFails.length === CONSECUTIVE_FAILURES_TO_PAUSE && recentFails.every((f) => f.status === "FAILED")) {
          await prisma.leadNurtureState.update({ where: { id: st.id }, data: { status: "PAUSED", pausedReason: "delivery_failures" } });
        }
        continue;
      }

      const patch = stateAfterSend(st as PlannableState, kind, now, s, { nurtureExhausted: kind === "NURTURE" ? unsent.length <= 1 : Boolean(st.nurtureExhaustedAt) });
      await prisma.$transaction(async (tx) => {
        const comm = await tx.communication.create({
          data: {
            leadId: lead.id,
            communicationType: "EMAIL",
            direction: "OUTBOUND",
            provider: "nurture",
            externalMessageId,
            fromValue: env.EMAIL_FROM || "",
            toValue: lead.email!,
            subject,
            body: rendered.text,
            status: "SENT",
            sentAt: now,
            createdByUserId: null,
          },
          select: { id: true },
        });
        await tx.leadNurtureSend.update({ where: { id: sendRow.id }, data: { status: "SENT", sentAt: now, error: null, communicationId: comm.id, externalMessageId } });
        await tx.activityLog.create({
          data: { leadId: lead.id, activityType: "EMAIL_LOGGED", title: `${kind === "FOLLOW_UP" ? "Automated follow-up" : "Automated nurture"}: ${subject}`, description: `Sent to ${lead.email}${rep ? ` from ${rep}` : ""}`, metadataJson: { nurture: true, kind, contentId: piece.id, sendId: sendRow.id } },
        });
        await tx.nurtureContent.update({ where: { id: piece.id }, data: { sentCount: { increment: 1 } } });
        await tx.leadNurtureState.update({ where: { id: st.id }, data: { ...patch, ...(kind === "NURTURE" && unsent.length <= 1 ? { nurtureExhaustedAt: now } : {}) } });
      });
      Object.assign(st, patch);
      result.sent++;
    } catch (err) {
      logger.exception(err, { where: "nurture.act", leadId: st.leadId });
      result.failed++;
      failures.push({ recipient: lead.email ?? st.leadId, reason: err instanceof Error ? err.message : "unknown" });
    }
  }

  // 6. Rep prompts: quiet leads, and the moment the scripted follow-ups run out.
  try {
    const fallback = await fallbackActor();
    for (const st of keep) {
      const quiet = shouldPromptRep(st as PlannableState, now, s);
      const exhausted = st.followUpStep >= s.followUpDays.length && !st.stepsExhaustedNotifiedAt;
      if (!quiet && !exhausted) continue;
      const actor = st.lead.assignedUserId ?? fallback;
      if (!actor) continue;
      result.prompts++;
      result.plan.push({ leadId: st.leadId, leadName: st.lead.fullName, email: st.lead.email, rep: null, kind: "PROMPT_REP", subject: null, reason: exhausted ? "scripted follow-ups exhausted" : `no personal touch for ${s.repPromptAfterDays}+ days` });
      if (dryRun) continue;
      await ensureAutoTask({ kind: "nurture.personal-touch", leadId: st.leadId }, actor, now);
      await prisma.leadNurtureState.update({ where: { id: st.id }, data: { ...(quiet ? { repPromptedAt: now } : {}), ...(exhausted ? { stepsExhaustedNotifiedAt: now } : {}) } });
    }
  } catch (err) {
    logger.exception(err, { where: "nurture.prompts" });
  }

  if (!dryRun) {
    await reportDelivery({ source: "cron.nurture", attempted: result.planned, sent: result.sent, failures, context: { enrolled: result.enrolled, stopped: result.stopped, prompts: result.prompts, due: result.due } });
  }
  result.failures = failures.map((f) => `${f.recipient}: ${f.reason}`);
  return result;
}

export function planSummary(r: NurtureRunResult): string {
  return `enrolled ${r.enrolled}, stopped ${r.stopped}, due ${r.due}, planned ${r.planned}, sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}, prompts ${r.prompts}`;
}

export { hoursBetween };
