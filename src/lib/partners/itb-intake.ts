import type { BidIntakeStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { pinAllDay, todayKey } from "@/lib/time/zone";
import { createBid, updateBid, type CreateBidInput } from "./bids";
import { PartnerError } from "./errors";
import { followUpOwnerId } from "./follow-up-run";
import { advanceLastContact } from "./interactions";
import { domainMatches, domainOf, emailOf, findExistingBid, FREE_MAIL_DOMAINS, htmlToText, isPlatformDomain, matchAccount, parseItbEmail, senderAllowed, suggestTrades, type AccountCandidate, type ParsedItb } from "./itb-parse";

/**
 * Phase 5 — bid invitations by email. Whatever channel brings an email in
 * (pasted on the intake page, MailerSend's inbound route, the Outlook poller),
 * it lands here: the raw email is kept as an InboundEmailEvent, the reader's
 * result as a BidIntake, and a person decides — create the bid, file it
 * against a bid already logged (an addendum, a new date), or dismiss it.
 * Nothing becomes a bid, and no date moves, without that person.
 */

export type IntakeChannel = "manual" | "mailersend" | "outlook";

export type IncomingEmail = {
  channel: IntakeChannel;
  externalId: string;
  from: string;
  fromName?: string | null;
  subject: string;
  text?: string | null;
  html?: string | null;
  receivedAt: Date;
  /** Set when a signed-in person pasted it: allowed whoever wrote it, and no review task. */
  submittedByUserId?: string | null;
};

export type IngestResult = { status: "queued" | "duplicate" | "ignored"; intakeId: string | null };

export const intakeTaskKey = (id: string) => `bid-intake:${id}`;

async function knownSenders() {
  const [users, contacts] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { email: true } }),
    prisma.contact.findMany({ where: { email: { not: null } }, select: { email: true } }),
  ]);
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const ownDomains = [...new Set(users.map((u) => domainOf(u.email)).filter((d): d is string => Boolean(d) && !domainMatches(d, FREE_MAIL_DOMAINS)))];
  return { userEmails, contactEmails: new Set(contacts.map((c) => c.email!.toLowerCase())), ownDomains };
}

async function accountCandidates(): Promise<AccountCandidate[]> {
  return prisma.organization.findMany({ where: { isActive: true }, select: { id: true, name: true, website: true, email: true, contacts: { where: { isActive: true }, select: { id: true, email: true } } } });
}

async function bidCandidates() {
  return prisma.bidInvitation.findMany({ select: { id: true, number: true, organizationId: true, projectName: true, platformRef: true, status: true }, orderBy: { createdAt: "desc" }, take: 2000 });
}

/** Mail the Outlook poller should hand here instead of reading it as a Google Ads lead. */
export async function isItbSender(fromEmail: string): Promise<boolean> {
  const e = emailOf(fromEmail);
  if (!e) return false;
  if (isPlatformDomain(domainOf(e))) return true;
  return (await prisma.contact.count({ where: { email: { equals: e, mode: "insensitive" } } })) > 0;
}

export async function ingestItbEmail(email: IncomingEmail): Promise<IngestResult> {
  const seen = await prisma.inboundEmailEvent.findUnique({ where: { externalMessageId: email.externalId }, select: { id: true, bidIntake: { select: { id: true } } } });
  if (seen) return { status: "duplicate", intakeId: seen.bidIntake?.id ?? null };

  const known = await knownSenders();
  const fromEmail = emailOf(email.from) ?? email.from.slice(0, 200);
  const base = {
    provider: email.channel === "outlook" ? "outlook_graph" : email.channel === "mailersend" ? "mailersend_inbound" : "manual",
    externalMessageId: email.externalId,
    senderEmail: fromEmail,
    subject: email.subject.slice(0, 500) || "(no subject)",
    receivedAt: email.receivedAt,
    rawBodyText: email.text ?? null,
    rawBodyHtml: email.html ?? null,
  };
  if (!email.submittedByUserId && !senderAllowed(fromEmail, known)) {
    await prisma.inboundEmailEvent.create({ data: { ...base, processingStatus: "IGNORED", parsingError: "Sender is not someone at KNU, a known contact or a bid platform", processedAt: new Date() } });
    logger.info("partners.itb.ignored", { channel: email.channel, sender: fromEmail });
    return { status: "ignored", intakeId: null };
  }

  const parsed = parseItbEmail({ from: email.from, fromName: email.fromName, subject: email.subject, text: email.text, html: email.html, receivedAt: email.receivedAt }, { ownDomains: known.ownDomains });
  const [accounts, bids] = await Promise.all([accountCandidates(), bidCandidates()]);
  const match = matchAccount(parsed, accounts);
  const existing = findExistingBid(parsed, match?.organizationId ?? null, bids);
  const organizationId = match?.organizationId ?? existing?.organizationId ?? null;

  const intake = await prisma.$transaction(async (tx) => {
    const event = await tx.inboundEmailEvent.create({ data: { ...base, processingStatus: "PARSED", parsedPayloadJson: parsed as unknown as Prisma.InputJsonValue, processedAt: new Date() } });
    return tx.bidIntake.create({
      data: {
        inboundEmailEventId: event.id,
        channel: email.channel,
        receivedAt: email.receivedAt,
        forwardedBy: fromEmail,
        subject: base.subject,
        platform: parsed.platform,
        parsed: parsed as unknown as Prisma.InputJsonValue,
        organizationId,
        contactId: match?.contactId ?? null,
        matchedBy: match?.how ?? (existing ? "existing bid" : null),
        existingBidId: existing?.id ?? null,
      },
      select: { id: true, organizationId: true, organization: { select: { owner: { select: { id: true, isActive: true } } } } },
    });
  });

  if (email.submittedByUserId) {
    await recordAudit({ actorUserId: email.submittedByUserId, entityType: "BidIntake", entityId: intake.id, action: "bid_intake_paste", after: { subject: base.subject, platform: parsed.platform, organizationId } });
  } else {
    await raiseReviewTask(intake.id, parsed, organizationId, intake.organization?.owner ?? null, existing?.number ?? null);
  }
  return { status: "queued", intakeId: intake.id };
}

async function raiseReviewTask(id: string, p: ParsedItb, organizationId: string | null, owner: { id: string; isActive: boolean } | null, existingNumber: string | null) {
  try {
    const assignee = await followUpOwnerId({ owner });
    if (!assignee) return;
    const what = p.projectName ?? p.originalSubject ?? "an email";
    const title =
      p.kind === "ADDENDUM" ? `File an addendum: ${what}` : p.kind === "UPDATE" ? `File a bid update: ${what}` : existingNumber ? `File an email on ${existingNumber}: ${what}` : `Review a bid invitation: ${what}`;
    const due = p.bidDue ? new Date(p.bidDue.at) : null;
    const soon = due ? due.getTime() - Date.now() < 3 * 86_400_000 : false;
    await createTask(
      {
        title: title.slice(0, 200),
        description: [
          `Arrived by email${p.platform !== "EMAIL" ? ` from ${p.platform}` : ""}${p.gcName ? ` for ${p.gcName}` : ""}.`,
          p.bidDue ? `Bid due ${p.bidDue.text}.` : null,
          `Open Business Development → Bid intake to create the bid, file it, or dismiss it: /partners/intake?item=${id}`,
        ].filter(Boolean).join("\n"),
        priority: soon ? "HIGH" : "MEDIUM",
        dueAt: pinAllDay(todayKey()),
        allDay: true,
        assignedUserId: assignee,
        createdByUserId: assignee,
        organizationId,
        source: "auto",
        sourceKey: intakeTaskKey(id),
      },
      { actorUserId: null, notify: "inline" },
    );
  } catch (err) {
    logger.exception(err, { where: "partners.itb.raiseReviewTask", intakeId: id });
  }
}

// ─── Reading ────────────────────────────────────────────────────────────────

const INTAKE_SELECT = {
  id: true,
  channel: true,
  receivedAt: true,
  forwardedBy: true,
  subject: true,
  platform: true,
  parsed: true,
  organizationId: true,
  contactId: true,
  matchedBy: true,
  existingBidId: true,
  status: true,
  bidInvitationId: true,
  dismissReason: true,
  resolvedAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  bidInvitation: { select: { id: true, number: true, leadId: true, projectName: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.BidIntakeSelect;

type IntakeRow = Prisma.BidIntakeGetPayload<{ select: typeof INTAKE_SELECT }>;

async function present(rows: IntakeRow[]) {
  const ids = [...new Set(rows.map((r) => r.existingBidId).filter((x): x is string => Boolean(x)))];
  const [bids, trades] = await Promise.all([
    ids.length ? prisma.bidInvitation.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, leadId: true, projectName: true, status: true, bidDueAt: true, addendaCount: true } }) : [],
    prisma.serviceCategory.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const byId = new Map(bids.map((b) => [b.id, b]));
  return rows.map((r) => {
    const parsed = r.parsed as unknown as ParsedItb;
    return {
      ...r,
      parsed,
      existingBid: r.existingBidId ? (byId.get(r.existingBidId) ?? null) : null,
      suggestedTradeIds: suggestTrades(`${parsed.scope ?? ""}\n${parsed.originalSubject}\n${parsed.projectName ?? ""}`, trades),
    };
  });
}

export type IntakeView = Awaited<ReturnType<typeof present>>[number];

export async function listIntakes(status: BidIntakeStatus | "DONE") {
  const where: Prisma.BidIntakeWhereInput = status === "DONE" ? { status: { in: ["CREATED", "ATTACHED"] } } : { status };
  const [rows, grouped] = await Promise.all([
    prisma.bidIntake.findMany({ where, orderBy: { receivedAt: "desc" }, take: 200, select: INTAKE_SELECT }),
    prisma.bidIntake.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<BidIntakeStatus, number>>;
  return { rows: await present(rows), counts: { NEW: counts.NEW ?? 0, DONE: (counts.CREATED ?? 0) + (counts.ATTACHED ?? 0), DISMISSED: counts.DISMISSED ?? 0 }, channels: intakeChannels() };
}

export function intakeChannels() {
  return { mailersend: Boolean(env.MAILERSEND_INBOUND_SECRET), outlook: Boolean(env.OUTLOOK_TENANT_ID && env.OUTLOOK_CLIENT_ID && env.OUTLOOK_CLIENT_SECRET && env.OUTLOOK_MAILBOX_ADDRESS) };
}

export async function countNewIntakes(): Promise<number> {
  return prisma.bidIntake.count({ where: { status: "NEW" } });
}

export async function getIntake(id: string) {
  const row = await prisma.bidIntake.findUnique({ where: { id }, select: { ...INTAKE_SELECT, email: { select: { senderEmail: true, rawBodyText: true, rawBodyHtml: true } } } });
  if (!row) throw new PartnerError(404, "Intake item not found");
  const [view] = await present([row]);
  const body = row.email.rawBodyText?.trim() ? row.email.rawBodyText : htmlToText(row.email.rawBodyHtml ?? "");
  return { ...view, body: body.slice(0, 20_000) };
}

// ─── Deciding ───────────────────────────────────────────────────────────────

async function openIntake(id: string) {
  const row = await prisma.bidIntake.findUnique({ where: { id }, select: { id: true, status: true, platform: true, subject: true, parsed: true, organizationId: true, inboundEmailEventId: true, forwardedBy: true, receivedAt: true } });
  if (!row) throw new PartnerError(404, "Intake item not found");
  if (row.status !== "NEW") throw new PartnerError(409, "This email has already been dealt with");
  return { ...row, parsed: row.parsed as unknown as ParsedItb };
}

async function resolve(id: string, data: Prisma.BidIntakeUncheckedUpdateInput, actorUserId: string, because: string, outcome: "COMPLETED" | "CANCELLED") {
  // Conditional on NEW: two people deciding at once cannot both win.
  const done = await prisma.bidIntake.updateMany({ where: { id, status: "NEW" }, data: { ...data, resolvedByUserId: actorUserId, resolvedAt: new Date() } as Prisma.BidIntakeUncheckedUpdateManyInput });
  if (done.count === 0) throw new PartnerError(409, "This email has already been dealt with");
  await closeAutoTask(intakeTaskKey(id), { actorUserId, outcome, because });
}

/** The person confirmed the fields: create the bid exactly as the bid form would. */
export async function createBidFromIntake(id: string, input: CreateBidInput, actorUserId: string) {
  const it = await openIntake(id);
  const bid = await createBid({ ...input, signalSource: `email:${it.platform}` }, actorUserId);
  try {
    await resolve(id, { status: "CREATED", bidInvitationId: bid.id, organizationId: bid.organizationId }, actorUserId, `Bid ${bid.number} created from the email`, "COMPLETED");
  } catch (err) {
    // The bid exists; the item was resolved by someone else meanwhile. Say so, keep the bid.
    logger.exception(err, { where: "partners.itb.createBidFromIntake", intakeId: id, bidId: bid.id });
  }
  await prisma.inboundEmailEvent.update({ where: { id: it.inboundEmailEventId }, data: { leadId: bid.leadId } });
  await prisma.activityLog.create({ data: { leadId: bid.leadId, activityType: "EMAIL_LOGGED", title: "Invitation email filed", description: `${it.subject} — forwarded by ${it.forwardedBy ?? "email"}`, metadataJson: { bidIntakeId: id }, createdByUserId: actorUserId } });
  await recordAudit({ actorUserId, entityType: "BidIntake", entityId: id, action: "bid_intake_create", after: { bidId: bid.id, number: bid.number } });
  return bid;
}

/** File the email on a bid already logged: an addendum, a new date, or just the record. */
export async function attachIntake(id: string, input: { bidId: string; countAddendum?: boolean; updateBidDue?: boolean }, actorUserId: string) {
  const it = await openIntake(id);
  const bid = await prisma.bidInvitation.findUnique({ where: { id: input.bidId }, select: { id: true, number: true, leadId: true, organizationId: true, contactId: true, addendaCount: true, bidDueAt: true } });
  if (!bid) throw new PartnerError(404, "Bid not found");
  const patch: { addendaCount?: number; bidDueAt?: string } = {};
  if (input.countAddendum) patch.addendaCount = bid.addendaCount + 1;
  if (input.updateBidDue) {
    if (!it.parsed.bidDue) throw new PartnerError(400, "updateBidDue: the email names no due date");
    patch.bidDueAt = it.parsed.bidDue.at;
  }
  if (Object.keys(patch).length) await updateBid(bid.id, patch, actorUserId);
  const changes = [patch.addendaCount !== undefined ? `addendum ${patch.addendaCount} counted` : null, patch.bidDueAt ? `due date set to ${it.parsed.bidDue!.text}` : null].filter(Boolean).join("; ");
  await prisma.$transaction(async (tx) => {
    await tx.activityLog.create({ data: { leadId: bid.leadId, activityType: "EMAIL_LOGGED", title: it.parsed.kind === "ADDENDUM" ? "Addendum email filed" : "Bid email filed", description: `${it.subject}${changes ? ` — ${changes}` : ""}`, metadataJson: { bidIntakeId: id }, createdByUserId: actorUserId } });
    // The GC wrote: a touch on the account, as the invitation itself is.
    await tx.interaction.create({ data: { organizationId: bid.organizationId, contactId: bid.contactId, leadId: bid.leadId, userId: actorUserId, kind: "BID_DISCUSSION", direction: "INBOUND", outcome: "NOT_APPLICABLE", occurredAt: it.receivedAt, summary: `${it.parsed.kind === "ADDENDUM" ? "Addendum" : "Email"} on ${bid.number}: ${it.subject}`.slice(0, 500) } });
    await advanceLastContact(tx, bid.organizationId, it.receivedAt);
    await tx.inboundEmailEvent.update({ where: { id: it.inboundEmailEventId }, data: { leadId: bid.leadId } });
  });
  await resolve(id, { status: "ATTACHED", bidInvitationId: bid.id, organizationId: bid.organizationId }, actorUserId, `Filed on ${bid.number}`, "COMPLETED");
  await recordAudit({ actorUserId, entityType: "BidIntake", entityId: id, action: "bid_intake_attach", after: { bidId: bid.id, ...patch } });
  return { bidId: bid.id, number: bid.number, leadId: bid.leadId };
}

export async function dismissIntake(id: string, reason: string | null, actorUserId: string) {
  await openIntake(id);
  await resolve(id, { status: "DISMISSED", dismissReason: reason?.trim() || null }, actorUserId, `Dismissed${reason ? `: ${reason}` : ""}`, "CANCELLED");
  await recordAudit({ actorUserId, entityType: "BidIntake", entityId: id, action: "bid_intake_dismiss", after: { reason } });
}

/** A person picks the account the reader could not (or picked wrong). */
export async function setIntakeAccount(id: string, organizationId: string | null, actorUserId: string) {
  const it = await openIntake(id);
  if (organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!org) throw new PartnerError(404, "Account not found");
  }
  const existing = findExistingBid(it.parsed, organizationId, await bidCandidates());
  await prisma.bidIntake.update({ where: { id }, data: { organizationId, contactId: null, matchedBy: organizationId ? "person" : null, existingBidId: existing?.id ?? null } });
  await recordAudit({ actorUserId, entityType: "BidIntake", entityId: id, action: "bid_intake_account", before: { organizationId: it.organizationId }, after: { organizationId } });
  return getIntake(id);
}
