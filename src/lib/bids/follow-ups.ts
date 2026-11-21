import type { BidMessageStatus, InteractionOutcome, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit/record";
import { sendEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/escape";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { logInteraction } from "@/lib/partners/interactions";
import { PartnerError } from "@/lib/partners/errors";
import { addWorkingDays } from "@/lib/time/working-days";
import { APP_TIME_ZONE, atLocalTime, isDayKey, localDateKey, todayKey } from "@/lib/time/zone";
import { absoluteUrl } from "@/lib/notifications/links";
import { ANCHOR_LABEL, cadenceConfig, nextPlanned, planCadence, slotTitle, slotsToRaise, type CadenceFacts, type PlannedSlot } from "./cadence";
import { BID_TASK_PREFIX, bidTaskKey, raiseActionTask } from "./events";
import { loadHolidays } from "./holidays";
import { contactLine } from "./intro-call";
import { DEFAULT_TEMPLATES, mergeTemplate, templateKeyFor, type TemplateKey } from "./templates";

/**
 * The follow-up cadence of a GC opportunity, run (PlanHub plan §6). The plan
 * is pure (`cadence.ts`); this writes it: one BidFollowUpAction row per slot
 * (unique), a call / review task, or an email draft plus its task. Logging a
 * call or a reply, a date the GC asked for, a pause — each replans the bid.
 *
 * Email is manual-first (Richard, 2026-11-18): a draft is filled from the
 * CRM's records and a person reads it, then sends it from the CRM (when
 * BID_EMAIL_SEND_ENABLED=1) or from Outlook and marks it sent. Nothing is
 * ever sent by the cron.
 */

const OPEN_FOR_CADENCE = ["SUBMITTED", "SHORTLISTED"] as const;
const ON_HOLD_STAGES = ["POSTPONED", "REBIDDING", "CANCELLED", "CLOSED"];
const LIVE_DRAFT: BidMessageStatus[] = ["DRAFT", "APPROVED", "FAILED", "UNCERTAIN"];

export const sendFromCrmEnabled = () => env.BID_EMAIL_SEND_ENABLED === "1";

const BID_SELECT = {
  id: true, number: true, leadId: true, projectName: true, status: true, organizationId: true,
  bidDueAt: true, expectedAwardAt: true, cadenceAnchorAt: true, requestedFollowUpAt: true, pausedUntil: true, pauseScope: true, pauseReason: true,
  primeStatus: true, lastMeaningfulContactAt: true, nextActionAt: true, nextActionLabel: true, pmUserId: true,
  organization: { select: { name: true } },
  contact: { select: { id: true, firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true, isActive: true, emailSuppressedAt: true } },
  purchasingContact: { select: { id: true, firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true, isActive: true, emailSuppressedAt: true } },
  bidProject: { select: { name: true, timeZone: true, stage: true } },
  submissions: { orderBy: { submittedAt: "asc" as const }, select: { submittedAt: true, amount: true, recipients: { select: { contact: { select: { id: true, firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true, isActive: true, emailSuppressedAt: true } } } } } },
  followUpActions: { select: { slotKey: true, kind: true, status: true } },
  scopes: { select: { scope: { select: { label: true, sortOrder: true } } } },
  lead: { select: { services: { select: { serviceCategory: { select: { name: true } } } } } },
} satisfies Prisma.BidInvitationSelect;

type BidRow = Prisma.BidInvitationGetPayload<{ select: typeof BID_SELECT }>;
type PersonRow = NonNullable<BidRow["contact"]>;
type Settings = { cadence: unknown; callHour: number; draftHour: number };

const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function loadSettings(): Promise<Settings> {
  const s = await prisma.bidFollowUpSettings.findUnique({ where: { id: "singleton" }, select: { cadence: true, callHour: true, draftHour: true } });
  return s ?? { cadence: null, callHour: 9, draftHour: 7 };
}

/** Who a follow-up email goes to: the purchasing contact, else the people the bid went to, else the bid's contact — the first with an address who has not asked to stop. */
export function emailRecipient(b: Pick<BidRow, "purchasingContact" | "submissions" | "contact">): PersonRow | null {
  const usable = (c: PersonRow | null | undefined): c is PersonRow => Boolean(c && c.isActive && c.email && !c.emailSuppressedAt);
  if (usable(b.purchasingContact)) return b.purchasingContact;
  const last = b.submissions[b.submissions.length - 1];
  const fromSub = last?.recipients.map((r) => r.contact).find(usable);
  if (fromSub) return fromSub;
  return usable(b.contact) ? b.contact : null;
}

function callContacts(b: BidRow): PersonRow[] {
  const seen = new Set<string>();
  const out: PersonRow[] = [];
  const last = b.submissions[b.submissions.length - 1];
  for (const c of [b.purchasingContact, ...(last?.recipients.map((r) => r.contact) ?? []), b.contact]) {
    if (c && c.isActive && !seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

const scopesOf = (b: BidRow) =>
  b.scopes.length ? [...b.scopes].sort((x, y) => x.scope.sortOrder - y.scope.sortOrder).map((x) => x.scope.label) : b.lead.services.map((x) => x.serviceCategory.name);

export function factsFor(b: BidRow, s: Settings, holidays: Set<string>, now: Date): CadenceFacts {
  return {
    now,
    tz: b.bidProject?.timeZone ?? APP_TIME_ZONE,
    holidays,
    config: cadenceConfig(s.cadence),
    callHour: s.callHour,
    draftHour: s.draftHour,
    open: (OPEN_FOR_CADENCE as readonly string[]).includes(b.status),
    projectOnHold: Boolean(b.bidProject && ON_HOLD_STAGES.includes(b.bidProject.stage)),
    firstSubmittedAt: b.submissions[0]?.submittedAt ?? null,
    bidDueAt: b.bidDueAt,
    cadenceAnchorAt: b.cadenceAnchorAt,
    requestedFollowUpAt: b.requestedFollowUpAt,
    expectedAwardAt: b.expectedAwardAt,
    pausedUntil: b.pausedUntil,
    pauseScope: b.pauseScope,
    primeStatus: b.primeStatus,
    lastMeaningfulContactAt: b.lastMeaningfulContactAt,
    canEmail: emailRecipient(b) !== null,
  };
}

function callDescription(b: BidRow, slot: PlannedSlot): string {
  const last = b.submissions[b.submissions.length - 1];
  const project = b.bidProject?.name ?? b.projectName;
  const what = last ? `${scopesOf(b).join(", ") || "our scope"} on ${project}, ${money(Number(last.amount))} (${b.number})` : `${project} (${b.number})`;
  const ask =
    slot.kind === "REVIEW"
      ? [
          `Nobody has had a meaningful update on ${b.number} in a long time. Decide where it stands:`,
          `- still alive: call ${b.organization.name}, log the call and set the next date;`,
          `- decided: record the outcome on the project page (lost, withdrawn, awarded) — silence never closes a bid by itself.`,
        ]
      : slot.reason === "award_watch"
        ? [`${b.organization.name} expected the owner's award around now. Ask whether the job was awarded, whether they won it, and when they will pick subs for ${what}.`]
        : slot.reason === "requested"
          ? [`${b.organization.name} asked us to follow up today about ${what}. Ask where it stands and what they need from us.`]
          : [`Follow up on ${what}. Ask whether they received it, where the owner's award stands, and whether they need anything to level our number.`];
  const people = callContacts(b);
  const who = people.length ? ["Who to call:", ...people.map((c) => contactLine({ ...c, name: fullName(c) }))].join("\n") : `Who to call: nobody at ${b.organization.name} is on file — add their estimator first (${absoluteUrl(`/partners/${b.organizationId}`)}).`;
  return [...ask, "", who, "", `Why today: ${slot.why}.`, `After the call: "Log call" on the bid tab (${absoluteUrl(`/leads/${b.leadId}?tab=bid`)}) with what they said and the next date.`].join("\n");
}

async function templateFor(key: TemplateKey): Promise<{ subject: string; body: string }> {
  const row = await prisma.bidEmailTemplate.findUnique({ where: { key }, select: { subject: true, body: true, active: true } });
  if (row?.active) return row;
  return DEFAULT_TEMPLATES.find((t) => t.key === key)!;
}

/** The draft for an email slot, filled from the records only. */
async function makeDraft(b: BidRow, slot: PlannedSlot, ownerId: string | null): Promise<string> {
  const to = emailRecipient(b);
  const emailIndex = b.followUpActions.filter((a) => a.kind === "EMAIL" && a.status !== "SUPERSEDED").length;
  const key = templateKeyFor(slot.slotKey, emailIndex);
  const sender = ownerId ? await prisma.user.findUnique({ where: { id: ownerId }, select: { firstName: true, lastName: true, phone: true, email: true } }) : null;
  const last = b.submissions[b.submissions.length - 1];
  const tz = b.bidProject?.timeZone ?? APP_TIME_ZONE;
  const merged = mergeTemplate(await templateFor(key), {
    contactFirstName: to?.firstName ?? null,
    project: b.bidProject?.name ?? b.projectName,
    scopes: scopesOf(b).join(", ").toLowerCase() || "our",
    amount: last ? money(Number(last.amount)) : null,
    sentDate: last ? last.submittedAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }) : null,
    senderName: sender ? fullName(sender) : "KNU Construction",
    senderPhone: sender?.phone ?? null,
  });
  const m = await prisma.bidMessage.create({
    data: {
      bidInvitationId: b.id,
      templateKey: key,
      toContactIds: to ? [to.id] : [],
      toEmails: to?.email ? [to.email] : [],
      ccEmails: sender?.email ? [sender.email] : [],
      subject: merged.subject,
      body: merged.body,
      status: "DRAFT",
      senderUserId: ownerId,
      sendAfter: slot.dueAt,
    },
    select: { id: true },
  });
  return m.id;
}

async function raiseSlot(b: BidRow, slot: PlannedSlot, systemUserId: string): Promise<boolean> {
  const project = b.bidProject?.name ?? b.projectName;
  const owner = b.pmUserId ? await prisma.user.findFirst({ where: { id: b.pmUserId, isActive: true }, select: { id: true } }) : null;
  const common = {
    bidId: b.id,
    slotKey: slot.slotKey,
    reason: slot.reason,
    dueAt: slot.dueAt,
    title: slotTitle(slot, b.organization.name, project, b.number),
    actorUserId: systemUserId,
    assigneeUserId: owner?.id ?? null,
    planInputs: { rule: slot.reason, slotKey: slot.slotKey, dueDay: slot.dueDay, why: slot.why },
  };
  if (slot.kind === "EMAIL") {
    return raiseActionTask({
      ...common,
      kind: "EMAIL",
      priority: "MEDIUM",
      description: [
        `A follow-up email to ${b.organization.name} is drafted on the bid tab (${absoluteUrl(`/leads/${b.leadId}?tab=bid`)}).`,
        `Read it, change anything that is not right, then send it — or send it from Outlook and press "Mark sent".`,
        "",
        `Why today: ${slot.why}.`,
      ].join("\n"),
      makeMessage: (ownerId) => makeDraft(b, slot, ownerId),
    });
  }
  return raiseActionTask({ ...common, kind: slot.kind, priority: slot.kind === "REVIEW" ? "MEDIUM" : "HIGH", description: callDescription(b, slot) });
}

/** Earliest open raised action, else the next planned slot: what the card and the lists show as "next". */
async function refreshNextAction(b: BidRow, slots: PlannedSlot[], now: Date) {
  const open = await prisma.bidFollowUpAction.findFirst({ where: { bidInvitationId: b.id, status: "RAISED" }, orderBy: { dueAt: "asc" }, select: { dueAt: true, kind: true, reason: true } });
  const recorded = new Set(b.followUpActions.map((a) => a.slotKey));
  const next = open ? { dueAt: open.dueAt, title: slotTitle({ kind: open.kind === "URGENT_CALL" ? "CALL" : open.kind, reason: open.reason as PlannedSlot["reason"] }, b.organization.name, b.bidProject?.name ?? b.projectName, b.number) } : (() => {
    const n = nextPlanned(slots, recorded, now);
    return n ? { dueAt: n.dueAt, title: slotTitle(n, b.organization.name, b.bidProject?.name ?? b.projectName, b.number) } : null;
  })();
  if ((next?.dueAt?.getTime() ?? null) !== (b.nextActionAt?.getTime() ?? null) || (next?.title ?? null) !== b.nextActionLabel) {
    await prisma.bidInvitation.update({ where: { id: b.id }, data: { nextActionAt: next?.dueAt ?? null, nextActionLabel: next?.title ?? null } });
  }
}

async function systemUser(): Promise<string> {
  const admin = await prisma.user.findFirst({ where: { isActive: true, role: { name: "ADMIN" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin) throw new Error("No active admin to raise bid follow-ups as");
  return admin.id;
}

export type RunResult = { opportunities: number; raised: number; superseded: number; cancelled: number; planned: { bid: string; slot: string; kind: string; dueDay: string }[] };

/** Plan and raise one opportunity's due slots. */
async function runOne(b: BidRow, s: Settings, holidays: Set<string>, now: Date, systemUserId: string, dryRun: boolean, out: RunResult) {
  const { slots } = planCadence(factsFor(b, s, holidays, now));
  const recorded = new Set(b.followUpActions.map((a) => a.slotKey));
  const { raise, supersede } = slotsToRaise(slots, recorded, now);
  for (const slot of raise) out.planned.push({ bid: b.number, slot: slot.slotKey, kind: slot.kind, dueDay: slot.dueDay });
  if (dryRun) return;
  if (supersede.length) {
    const r = await prisma.bidFollowUpAction.createMany({
      data: supersede.map((x) => ({ bidInvitationId: b.id, slotKey: x.slotKey, kind: x.kind, reason: x.reason, dueAt: x.dueAt, status: "SUPERSEDED" as const, planInputs: { why: x.why, supersededBy: raise[0]?.slotKey ?? null } })),
      skipDuplicates: true,
    });
    out.superseded += r.count;
  }
  for (const slot of raise) {
    try {
      if (await raiseSlot(b, slot, systemUserId)) out.raised += 1;
    } catch (err) {
      logger.exception(err, { where: "bids.follow-ups.raise", bidId: b.id, slot: slot.slotKey });
    }
  }
  const fresh = await prisma.bidInvitation.findUnique({ where: { id: b.id }, select: BID_SELECT });
  if (fresh) await refreshNextAction(fresh, slots, now);
}

/** The cron: every open, sent opportunity — raise what is due; close what a closed bid left open. */
export async function runBidFollowUps(opts: { now?: Date; dryRun?: boolean } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const [s, holidays, systemUserId] = await Promise.all([loadSettings(), loadHolidays(), systemUser()]);
  const out: RunResult = { opportunities: 0, raised: 0, superseded: 0, cancelled: 0, planned: [] };
  const rows = await prisma.bidInvitation.findMany({ where: { status: { in: [...OPEN_FOR_CADENCE] }, submissions: { some: {} } }, select: BID_SELECT });
  out.opportunities = rows.length;
  for (const b of rows) await runOne(b, s, holidays as Set<string>, now, systemUserId, Boolean(opts.dryRun), out);
  if (!opts.dryRun) {
    const closed = await prisma.bidInvitation.findMany({ where: { status: "CLOSED", followUpActions: { some: { status: "RAISED" } } }, select: { id: true } });
    for (const c of closed) out.cancelled += await cancelOpenFollowUps(c.id, "the bid is closed", systemUserId);
  }
  return out;
}

/** Replan one opportunity now (after a call, a reply, a date). */
export async function replanBid(bidId: string, actorUserId: string) {
  const b = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: BID_SELECT });
  if (!b) return;
  const [s, holidays] = await Promise.all([loadSettings(), loadHolidays()]);
  await runOne(b, s, holidays as Set<string>, new Date(), actorUserId, false, { opportunities: 0, raised: 0, superseded: 0, cancelled: 0, planned: [] });
}

/** Close the open follow-ups of an opportunity (its tasks and unsent drafts) with a reason. `kinds` limits it (a reply cancels emails only). */
export async function cancelOpenFollowUps(bidId: string, because: string, actorUserId: string | null, kinds?: ("CALL" | "EMAIL" | "REVIEW" | "URGENT_CALL")[]): Promise<number> {
  const open = await prisma.bidFollowUpAction.findMany({ where: { bidInvitationId: bidId, status: "RAISED", ...(kinds ? { kind: { in: kinds } } : {}) }, select: { id: true, slotKey: true, messageId: true } });
  for (const a of open) {
    await closeAutoTask(bidTaskKey(bidId, a.slotKey), { actorUserId, outcome: "CANCELLED", because: `Follow-up no longer needed: ${because}` });
    await prisma.bidFollowUpAction.update({ where: { id: a.id }, data: { status: "CANCELLED", outcome: because } });
    if (a.messageId) await prisma.bidMessage.updateMany({ where: { id: a.messageId, status: { in: LIVE_DRAFT } }, data: { status: "CANCELLED", cancelReason: because } });
  }
  return open.length;
}

/** A `bidfu:` task closed from the task side (`updateTask`): its slot is done or dropped; a dropped email's draft goes with it. */
export async function onFollowUpTaskClosed(sourceKey: string, status: "COMPLETED" | "CANCELLED") {
  const rest = sourceKey.slice(BID_TASK_PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 0) return;
  const bidId = rest.slice(0, i);
  const slotKey = rest.slice(i + 1);
  const a = await prisma.bidFollowUpAction.findUnique({ where: { bidInvitationId_slotKey: { bidInvitationId: bidId, slotKey } }, select: { id: true, status: true, messageId: true } });
  if (!a || a.status !== "RAISED") return;
  await prisma.bidFollowUpAction.update({ where: { id: a.id }, data: { status: status === "COMPLETED" ? "DONE" : "CANCELLED", outcome: status === "COMPLETED" ? "task completed" : "task cancelled" } });
  if (status === "CANCELLED" && a.messageId) await prisma.bidMessage.updateMany({ where: { id: a.messageId, status: { in: LIVE_DRAFT } }, data: { status: "CANCELLED", cancelReason: "the follow-up task was cancelled" } });
}

// ─── Things people log ───────────────────────────────────────────────────────

async function bidOrThrow(bidId: string) {
  const b = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { id: true, leadId: true, organizationId: true, status: true, number: true, bidProject: { select: { timeZone: true } } } });
  if (!b) throw new PartnerError(404, "Bid not found");
  return b;
}

async function contactAtGc(organizationId: string, contactId: string | null | undefined) {
  if (!contactId) return null;
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, organizationId: true, email: true, firstName: true, lastName: true } });
  if (!c || c.organizationId !== organizationId) throw new PartnerError(400, "contactId: that person is not at this GC");
  return c;
}

/** "yyyy-MM-dd" → a working day at the call hour; past days refused. */
async function nextDayOf(day: string | null | undefined, tz: string): Promise<Date | null> {
  if (!day) return null;
  if (!isDayKey(day)) throw new PartnerError(400, "nextDay: a day as yyyy-MM-dd");
  if (day < todayKey(new Date(), tz)) throw new PartnerError(400, "nextDay: pick today or a later day");
  return atLocalTime(day, 9, 0, tz);
}

export type LogCallInput = { contactId?: string | null; outcome: Extract<InteractionOutcome, "SPOKE" | "LEFT_MESSAGE" | "NO_ANSWER">; summary: string; nextDay?: string | null };

/**
 * A call to the GC. It closes the call the cadence had due (and, when someone
 * answered, the email that was due — its draft is withdrawn); a conversation
 * counts as contact (the 90-day review moves); a next day the GC named
 * becomes the next follow-up.
 */
export async function logBidCall(bidId: string, input: LogCallInput, actorUserId: string) {
  const b = await bidOrThrow(bidId);
  const tz = b.bidProject?.timeZone ?? APP_TIME_ZONE;
  const contact = await contactAtGc(b.organizationId, input.contactId);
  const next = await nextDayOf(input.nextDay, tz);
  const summary = input.summary.trim();
  if (!summary) throw new PartnerError(400, "summary: say what happened");
  const { interaction } = await logInteraction(b.organizationId, { kind: "CALL", direction: "OUTBOUND", outcome: input.outcome, summary, contactId: contact?.id ?? null, leadId: b.leadId }, actorUserId);
  await prisma.interaction.update({ where: { id: interaction.id }, data: { bidInvitationId: bidId } });

  const endOfToday = atLocalTime(todayKey(new Date(), tz), 23, 59, tz);
  // The call that was due is done. Having actually spoken with them, the
  // generic email that was due is pointless too: it is done and its draft withdrawn.
  const kinds: ("CALL" | "URGENT_CALL" | "REVIEW" | "EMAIL")[] = input.outcome === "SPOKE" ? ["CALL", "URGENT_CALL", "REVIEW", "EMAIL"] : ["CALL", "URGENT_CALL", "REVIEW"];
  const dueCalls = await prisma.bidFollowUpAction.findMany({ where: { bidInvitationId: bidId, status: "RAISED", kind: { in: kinds }, dueAt: { lte: endOfToday } }, select: { id: true, slotKey: true, kind: true, messageId: true } });
  for (const a of dueCalls) {
    await closeAutoTask(bidTaskKey(bidId, a.slotKey), { actorUserId, outcome: "COMPLETED", because: a.kind === "EMAIL" ? "Spoke with the GC on the phone instead" : "The call was logged on the bid" });
    await prisma.bidFollowUpAction.update({ where: { id: a.id }, data: { status: "DONE", outcome: `${a.kind === "EMAIL" ? "replaced by a call — " : ""}${input.outcome.toLowerCase().replace("_", " ")}: ${summary.slice(0, 200)}` } });
    if (a.messageId) await prisma.bidMessage.updateMany({ where: { id: a.messageId, status: { in: LIVE_DRAFT } }, data: { status: "CANCELLED", cancelReason: "spoke with the GC on the phone instead" } });
  }
  await prisma.bidInvitation.update({
    where: { id: bidId },
    data: {
      ...(input.outcome === "SPOKE" ? { lastMeaningfulContactAt: new Date() } : {}),
      ...(next ? { requestedFollowUpAt: next } : {}),
    },
  });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_call_logged", after: { interactionId: interaction.id, outcome: input.outcome, closed: dueCalls.length, nextDay: input.nextDay ?? null } });
  await replanBid(bidId, actorUserId);
  return { interactionId: interaction.id, closed: dueCalls.length };
}

export type LogReplyInput = { contactId?: string | null; summary: string; nextDay?: string | null };

/**
 * The GC answered by email. Their answer is the contact: the generic email
 * steps stop (unsent drafts are withdrawn) and hold until the day they named,
 * else for 15 business days; calls carry on.
 */
export async function logBidReply(bidId: string, input: LogReplyInput, actorUserId: string) {
  const b = await bidOrThrow(bidId);
  const tz = b.bidProject?.timeZone ?? APP_TIME_ZONE;
  const contact = await contactAtGc(b.organizationId, input.contactId);
  const next = await nextDayOf(input.nextDay, tz);
  const summary = input.summary.trim();
  if (!summary) throw new PartnerError(400, "summary: say what they wrote");
  const { interaction } = await logInteraction(b.organizationId, { kind: "EMAIL", direction: "INBOUND", outcome: "REPLIED", summary, contactId: contact?.id ?? null, leadId: b.leadId }, actorUserId);
  await prisma.interaction.update({ where: { id: interaction.id }, data: { bidInvitationId: bidId } });
  await prisma.communication.create({
    data: { leadId: b.leadId, bidInvitationId: bidId, communicationType: "EMAIL", direction: "INBOUND", provider: "bid-logged", fromValue: contact ? `${fullName(contact)}${contact.email ? ` <${contact.email}>` : ""}` : "GC", toValue: "KNU", subject: `Reply about ${b.number}`, body: summary, status: "RECEIVED", receivedAt: new Date(), createdByUserId: actorUserId },
  });
  const withdrawn = await cancelOpenFollowUps(bidId, "the GC replied", actorUserId, ["EMAIL"]);
  const holdUntil = next ?? atLocalTime(addWorkingDays(todayKey(new Date(), tz), 15), 9, 0, tz);
  await prisma.bidInvitation.update({
    where: { id: bidId },
    data: { lastMeaningfulContactAt: new Date(), pausedUntil: holdUntil, pauseScope: "email", pauseReason: "The GC replied", ...(next ? { requestedFollowUpAt: next } : {}) },
  });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_reply_logged", after: { interactionId: interaction.id, withdrawnDrafts: withdrawn, holdUntil, nextDay: input.nextDay ?? null } });
  await replanBid(bidId, actorUserId);
  return { interactionId: interaction.id, withdrawn };
}

export type NextActionInput =
  | { action: "set_date"; day: string }
  | { action: "clear_date" }
  | { action: "pause"; until: string; scope: "email" | "all"; reason: string }
  | { action: "resume" }
  | { action: "set_anchor"; day: string | null };

/** The person sets the pace: a date the GC asked for, a pause, or the cadence's anchor. */
export async function setBidNextAction(bidId: string, input: NextActionInput, actorUserId: string) {
  const b = await bidOrThrow(bidId);
  const tz = b.bidProject?.timeZone ?? APP_TIME_ZONE;
  let data: Prisma.BidInvitationUpdateInput;
  switch (input.action) {
    case "set_date":
      data = { requestedFollowUpAt: await nextDayOf(input.day, tz) };
      break;
    case "clear_date":
      data = { requestedFollowUpAt: null };
      break;
    case "pause": {
      const until = await nextDayOf(input.until, tz);
      if (!input.reason.trim()) throw new PartnerError(400, "reason: say why the follow-ups pause");
      data = { pausedUntil: until, pauseScope: input.scope, pauseReason: input.reason.trim() };
      if (input.scope === "all") await cancelOpenFollowUps(bidId, `paused: ${input.reason.trim()}`, actorUserId);
      else await cancelOpenFollowUps(bidId, `emails paused: ${input.reason.trim()}`, actorUserId, ["EMAIL"]);
      break;
    }
    case "resume":
      data = { pausedUntil: null, pauseScope: null, pauseReason: null };
      break;
    case "set_anchor":
      if (input.day !== null && !isDayKey(input.day)) throw new PartnerError(400, "day: a day as yyyy-MM-dd");
      data = { cadenceAnchorAt: input.day ? atLocalTime(input.day, 12, 0, tz) : null };
      break;
  }
  await prisma.bidInvitation.update({ where: { id: bidId }, data });
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_follow_up_pace", after: input });
  await replanBid(bidId, actorUserId);
}

// ─── The card ────────────────────────────────────────────────────────────────

export async function getBidFollowUps(bidId: string, viewer: { id: string; role: string }) {
  const b = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: BID_SELECT });
  if (!b) throw new PartnerError(404, "Bid not found");
  const [s, holidays] = await Promise.all([loadSettings(), loadHolidays()]);
  const now = new Date();
  const f = factsFor(b, s, holidays as Set<string>, now);
  const { anchor, slots } = planCadence(f);
  const actions = await prisma.bidFollowUpAction.findMany({
    where: { bidInvitationId: bidId, status: { not: "SUPERSEDED" } },
    orderBy: { dueAt: "desc" },
    take: 20,
    select: { id: true, slotKey: true, kind: true, reason: true, status: true, dueAt: true, taskId: true, outcome: true, planInputs: true },
  });
  const recorded = new Set(b.followUpActions.map((a) => a.slotKey));
  const upcoming = slots.filter((x) => !recorded.has(x.slotKey) && x.dueAt > now).slice(0, 4);
  const messages = await prisma.bidMessage.findMany({
    where: { bidInvitationId: bidId, OR: [{ status: { in: LIVE_DRAFT } }, { status: "SENT", sentAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, subject: true, body: true, toEmails: true, ccEmails: true, senderUserId: true, sentAt: true, error: true, createdAt: true, templateKey: true },
  });
  const recipient = emailRecipient(b);
  const tz = f.tz;
  return {
    open: f.open,
    onHold: f.projectOnHold,
    anchor: anchor ? { day: anchor.day, source: anchor.source, label: ANCHOR_LABEL[anchor.source] } : null,
    requestedDay: b.requestedFollowUpAt ? localDateKey(b.requestedFollowUpAt, tz) : null,
    pause: b.pausedUntil && b.pausedUntil > now ? { until: localDateKey(b.pausedUntil, tz), scope: b.pauseScope, reason: b.pauseReason } : null,
    next: b.nextActionAt ? { at: b.nextActionAt, label: b.nextActionLabel } : null,
    recipient: recipient ? { id: recipient.id, name: fullName(recipient), email: recipient.email } : null,
    contacts: callContacts(b).map((c) => ({ id: c.id, name: fullName(c), title: c.title, phone: c.phone, mobile: c.mobile, email: c.email })),
    upcoming: upcoming.map((x) => ({ slotKey: x.slotKey, kind: x.kind, dueAt: x.dueAt, dueDay: x.dueDay, why: x.why })),
    actions,
    messages: messages.map((m) => ({ ...m, canSend: m.senderUserId === viewer.id || viewer.role === "ADMIN" || viewer.role === "MANAGER" })),
    sendFromCrm: sendFromCrmEnabled(),
  };
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

async function draftOrThrow(messageId: string) {
  const m = await prisma.bidMessage.findUnique({
    where: { id: messageId },
    select: { id: true, status: true, subject: true, body: true, toEmails: true, ccEmails: true, toContactIds: true, senderUserId: true, bidInvitationId: true, bidInvitation: { select: { leadId: true, organizationId: true, status: true, number: true } }, actions: { select: { id: true, slotKey: true } } },
  });
  if (!m) throw new PartnerError(404, "Email not found");
  return m;
}

/** Whose draft it is to send: its sender, or an admin / manager. */
export function maySendDraft(m: { senderUserId: string | null }, actor: { id: string; role: string }) {
  return m.senderUserId === actor.id || m.senderUserId === null || actor.role === "ADMIN" || actor.role === "MANAGER";
}

export async function bidIdOfMessage(messageId: string): Promise<string | null> {
  const m = await prisma.bidMessage.findUnique({ where: { id: messageId }, select: { bidInvitationId: true } });
  return m?.bidInvitationId ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateDraft(messageId: string, patch: { subject?: string; body?: string; toEmails?: string[] }, actor: { id: string; role: string }) {
  const m = await draftOrThrow(messageId);
  if (!maySendDraft(m, actor)) throw new PartnerError(403, "Only the person it is from, or a manager, can change this email");
  if (m.status !== "DRAFT" && m.status !== "FAILED") throw new PartnerError(409, "This email has already gone or was withdrawn");
  if (patch.toEmails && patch.toEmails.some((e) => !EMAIL_RE.test(e))) throw new PartnerError(400, "toEmails: one of the addresses is not an email");
  return prisma.bidMessage.update({
    where: { id: messageId },
    data: { ...(patch.subject !== undefined ? { subject: patch.subject.trim() } : {}), ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.toEmails ? { toEmails: patch.toEmails } : {}), status: "DRAFT", error: null },
    select: { id: true, status: true },
  });
}

async function finishSent(m: Awaited<ReturnType<typeof draftOrThrow>>, actorUserId: string, via: "crm" | "outlook", externalId: string | null) {
  const sentAt = new Date();
  const comm = await prisma.communication.create({
    data: { leadId: m.bidInvitation.leadId, bidInvitationId: m.bidInvitationId, communicationType: "EMAIL", direction: "OUTBOUND", provider: via === "crm" ? "bid-followup" : "bid-outlook", externalMessageId: externalId, fromValue: via === "crm" ? env.EMAIL_FROM || "" : "sent from Outlook", toValue: [...m.toEmails, ...m.ccEmails.map((c) => `cc ${c}`)].join(", "), subject: m.subject, body: m.body, status: "SENT", sentAt, createdByUserId: actorUserId },
    select: { id: true },
  });
  await prisma.bidMessage.update({ where: { id: m.id }, data: { status: "SENT", sentAt, sentByUserId: actorUserId, communicationId: comm.id, externalMessageId: externalId, error: null } });
  const contactId = m.toContactIds[0] ?? null;
  const { interaction } = await logInteraction(m.bidInvitation.organizationId, { kind: "EMAIL", direction: "OUTBOUND", outcome: "SENT", summary: `${m.subject}${via === "outlook" ? " (sent from Outlook)" : ""}`, contactId, leadId: m.bidInvitation.leadId }, actorUserId).catch(() => ({ interaction: null }));
  if (interaction) await prisma.interaction.update({ where: { id: interaction.id }, data: { bidInvitationId: m.bidInvitationId } });
  for (const a of m.actions) {
    await closeAutoTask(bidTaskKey(m.bidInvitationId, a.slotKey), { actorUserId, outcome: "COMPLETED", because: via === "crm" ? "The email was sent from the CRM" : "The email was sent from Outlook" });
    await prisma.bidFollowUpAction.update({ where: { id: a.id }, data: { status: "DONE", outcome: `sent (${via})` } });
  }
  await recordAudit({ actorUserId, entityType: "BidMessage", entityId: m.id, action: "bid_email_sent", after: { via, to: m.toEmails, subject: m.subject, communicationId: comm.id } });
  await replanBid(m.bidInvitationId, actorUserId);
}

/** The person sent it from Outlook: record it as sent, close its task. */
export async function markDraftSent(messageId: string, actor: { id: string; role: string }) {
  const m = await draftOrThrow(messageId);
  if (!maySendDraft(m, actor)) throw new PartnerError(403, "Only the person it is from, or a manager, can mark this email sent");
  const claimed = await prisma.bidMessage.updateMany({ where: { id: messageId, status: { in: ["DRAFT", "FAILED", "UNCERTAIN"] } }, data: { status: "SENDING", sendStartedAt: new Date() } });
  if (!claimed.count) throw new PartnerError(409, "This email has already gone or was withdrawn");
  await finishSent(m, actor.id, "outlook", null);
}

/** Send from the CRM (MailerSend), from the company address with reply-to and cc the person. Only when BID_EMAIL_SEND_ENABLED=1. */
export async function sendDraft(messageId: string, actor: { id: string; role: string; email?: string | null }) {
  if (!sendFromCrmEnabled()) throw new PartnerError(409, "Sending from the CRM is off. Copy the email into Outlook, send it, then press Mark sent.");
  const m = await draftOrThrow(messageId);
  if (!maySendDraft(m, actor)) throw new PartnerError(403, "Only the person it is from, or a manager, can send this email");
  if (m.bidInvitation.status === "CLOSED") throw new PartnerError(409, "The bid is closed; this email is no longer needed");
  if (!m.toEmails.length) throw new PartnerError(400, "toEmails: add who it goes to");
  const suppressed = await prisma.contact.count({ where: { email: { in: m.toEmails, mode: "insensitive" }, emailSuppressedAt: { not: null } } });
  if (suppressed) throw new PartnerError(409, "One of the recipients asked not to be emailed. Call them instead.");
  const claimed = await prisma.bidMessage.updateMany({ where: { id: messageId, status: { in: ["DRAFT", "FAILED"] } }, data: { status: "SENDING", sendStartedAt: new Date() } });
  if (!claimed.count) throw new PartnerError(409, "This email has already gone or was withdrawn");
  try {
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(m.body).replace(/\n/g, "<br/>")}</div>`;
    const r = await sendEmail({ to: m.toEmails, cc: m.ccEmails.length ? m.ccEmails : undefined, subject: m.subject, html, text: m.body, replyTo: actor.email || undefined });
    if (!r) throw new Error("email is not set up on this server");
    await finishSent(m, actor.id, "crm", r.id);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "send failed";
    await prisma.bidMessage.update({ where: { id: messageId }, data: { status: "FAILED", error: reason } });
    logger.warn("bid follow-up send failed", { messageId, reason });
    throw new PartnerError(409, `The email was not sent: ${reason}`);
  }
}

/** Not needed after all: the draft is withdrawn and its task closed. */
export async function discardDraft(messageId: string, reason: string, actor: { id: string; role: string }) {
  const m = await draftOrThrow(messageId);
  if (!maySendDraft(m, actor)) throw new PartnerError(403, "Only the person it is from, or a manager, can discard this email");
  const because = reason.trim() || "discarded";
  const done = await prisma.bidMessage.updateMany({ where: { id: messageId, status: { in: LIVE_DRAFT } }, data: { status: "CANCELLED", cancelReason: because } });
  if (!done.count) throw new PartnerError(409, "This email has already gone or was withdrawn");
  for (const a of m.actions) {
    await closeAutoTask(bidTaskKey(m.bidInvitationId, a.slotKey), { actorUserId: actor.id, outcome: "CANCELLED", because: `The email was not sent: ${because}` });
    await prisma.bidFollowUpAction.update({ where: { id: a.id }, data: { status: "CANCELLED", outcome: because } });
  }
  await recordAudit({ actorUserId: actor.id, entityType: "BidMessage", entityId: messageId, action: "bid_email_discarded", after: { reason: because } });
  await replanBid(m.bidInvitationId, actor.id);
}

