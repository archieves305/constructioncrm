import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { escapeHtml } from "@/lib/email/escape";
import { sendEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { readFile } from "@/lib/files/storage";
import { formatAddressLine } from "@/lib/labels/address";
import { logger } from "@/lib/logger";
import { dayKey, dayKeyToLocalDate } from "@/lib/time/zone";
import type { MessageCreateInput, MessagePatchInput } from "./correction-validation";
import * as emailPrompt from "./prompts/correction-email";
import { PermitIntelError } from "./service";

/**
 * Emails about a permit. A draft — typed, or first written by the AI from a
 * party's correction items — is edited freely and sent only by a person's
 * click. Mail goes from the company sender with the person as reply-to (the
 * nurture pattern), and once sent it is correspondence: a Communication on
 * the job's lead and a line in the permit's history.
 */
type Actor = { id: string; role: RoleName; name: string; email: string };

/** What MailerSend takes in one message, with room for the body. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const PARTY_ROLE_NAME: Record<string, string> = {
  OWNER: "the property owner",
  APPLICANT: "the permit applicant",
  QUALIFIER: "the qualifier",
  ARCHITECT: "the architect",
  ENGINEER_OF_RECORD: "the engineer of record",
  SUBCONTRACTOR: "a subcontractor",
  OTHER: "a party on the permit",
};

/** "Friday, November 6, 2026", the office's calendar day. */
const longDay = (d: Date) => dayKeyToLocalDate(dayKey(d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

async function loadPermitForMail(permitId: string) {
  const p = await prisma.jobPermit.findUnique({
    where: { id: permitId },
    select: {
      id: true,
      municipality: true,
      permitType: true,
      permitNumber: true,
      applicationNumber: true,
      job: { select: { id: true, leadId: true, lead: { select: { propertyAddress1: true, propertyAddress2: true, city: true, state: true, zipCode: true } } } },
    },
  });
  if (!p) throw new PermitIntelError(404, "Permit not found");
  return p;
}

const referenceOf = (p: { permitType: string | null; permitNumber: string | null; applicationNumber: string | null }) =>
  [p.permitType ? `${p.permitType} permit` : "Permit", p.permitNumber ? `permit no. ${p.permitNumber}` : null, p.applicationNumber ? `application no. ${p.applicationNumber}` : null].filter(Boolean).join(", ");

export async function createMessage(permitId: string, input: MessageCreateInput, actor: Actor) {
  const permit = await loadPermitForMail(permitId);
  const party = input.partyId ? await prisma.permitParty.findUnique({ where: { id: input.partyId }, select: { id: true, permitId: true, name: true, role: true, email: true } }) : null;
  if (input.partyId && party?.permitId !== permitId) throw new PermitIntelError(400, "That party is not on this permit");
  const itemIds = [...new Set(input.correctionItemIds ?? [])];
  const items = itemIds.length
    ? await prisma.permitCorrectionItem.findMany({ where: { id: { in: itemIds }, permitId }, orderBy: [{ notice: { receivedAt: "asc" } }, { sortOrder: "asc" }], select: { id: true, reviewerItemNumber: true, text: true, affectsRef: true, dueAt: true, notice: { select: { responseDueAt: true } } } })
    : [];
  if (items.length !== itemIds.length) throw new PermitIntelError(400, "Every correction in the email must be one of this permit's");

  let subject = input.subject?.trim() || "";
  let body = input.body ?? "";
  let aiCallId: string | null = null;
  const address = formatAddressLine(permit.job.lead) || "the property";
  if (input.ai) {
    if (!items.length) throw new PermitIntelError(400, "Pick the corrections the email is about");
    const due = items.map((i) => i.dueAt ?? i.notice.responseDueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const ctx: emailPrompt.EmailContext = {
      sender: actor.name,
      recipient: { name: party?.name ?? null, role: party ? PARTY_ROLE_NAME[party.role] ?? party.role : "recipient" },
      permit: { address, jurisdiction: permit.municipality, reference: referenceOf(permit) },
      neededBy: due ? longDay(due) : null,
      items: items.map((i) => ({ number: i.reviewerItemNumber, text: i.text, affectsRef: i.affectsRef })),
    };
    const r = await runAiCall({
      subjectType: "permit",
      subjectId: permitId,
      purpose: emailPrompt.PURPOSE,
      promptVersion: emailPrompt.PROMPT_VERSION,
      schema: emailPrompt.schema,
      inputs: ctx,
      system: emailPrompt.SYSTEM,
      content: emailPrompt.content(ctx),
      model: emailPrompt.MODEL,
      effort: "medium",
      maxTokens: 8_000,
      userId: actor.id,
    });
    subject = r.output.subject.trim().slice(0, 300);
    body = r.output.body.trim();
    aiCallId = r.callId;
  }
  if (!subject) subject = `${address} — ${referenceOf(permit)}`;
  const message = await prisma.permitMessage.create({
    data: {
      permitId,
      partyId: party?.id ?? null,
      toEmails: input.toEmails ?? (party?.email ? [party.email.toLowerCase()] : []),
      ccEmails: input.ccEmails ?? [],
      subject,
      body,
      purpose: input.purpose ?? (items.length ? "correction_request" : "other"),
      correctionItemIds: items.map((i) => i.id),
      attachmentFileIds: [],
      aiCallId,
      createdByUserId: actor.id,
    },
  });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: permitId, action: "permit_message_draft", after: { messageId: message.id, partyId: message.partyId, items: items.length, ai: !!aiCallId } });
  return message;
}

async function draftOf(messageId: string) {
  const m = await prisma.permitMessage.findUnique({ where: { id: messageId } });
  if (!m) throw new PermitIntelError(404, "Email not found");
  if (m.status !== "DRAFT") throw new PermitIntelError(409, m.status === "SENT" ? "This email has been sent and cannot be changed" : "This draft was discarded");
  return m;
}

export async function updateMessage(messageId: string, patch: MessagePatchInput) {
  const m = await draftOf(messageId);
  if (patch.attachmentFileIds) {
    const ids = [...new Set(patch.attachmentFileIds)];
    const n = await prisma.file.count({ where: { id: { in: ids }, permitId: m.permitId } });
    if (n !== ids.length) throw new PermitIntelError(400, "Attachments must be this permit's documents");
    patch = { ...patch, attachmentFileIds: ids };
  }
  if (patch.correctionItemIds) {
    const ids = [...new Set(patch.correctionItemIds)];
    const n = await prisma.permitCorrectionItem.count({ where: { id: { in: ids }, permitId: m.permitId } });
    if (n !== ids.length) throw new PermitIntelError(400, "Every correction in the email must be one of this permit's");
    patch = { ...patch, correctionItemIds: ids };
  }
  return prisma.permitMessage.update({ where: { id: messageId }, data: patch });
}

export async function discardMessage(messageId: string, actor: Actor) {
  const m = await draftOf(messageId);
  await prisma.permitMessage.update({ where: { id: messageId }, data: { status: "DISCARDED" } });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: m.permitId, action: "permit_message_discard", before: { messageId, subject: m.subject } });
}

function bodyHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Send a draft. Claimed first (DRAFT → SENT in one conditional write), so two
 * clicks never send twice; a failed send puts it back as a draft.
 */
export async function sendMessage(messageId: string, actor: Actor) {
  const m = await draftOf(messageId);
  if (!m.toEmails.length) throw new PermitIntelError(400, "Add at least one recipient");
  if (!m.subject.trim() || !m.body.trim()) throw new PermitIntelError(400, "The email needs a subject and a body");
  const permit = await loadPermitForMail(m.permitId);

  const files = m.attachmentFileIds.length ? await prisma.file.findMany({ where: { id: { in: m.attachmentFileIds }, permitId: m.permitId }, select: { id: true, fileName: true, fileSize: true, storageKey: true } }) : [];
  if (files.length !== m.attachmentFileIds.length) throw new PermitIntelError(409, "An attachment is no longer on the permit. Remove it and try again.");
  const total = files.reduce((s, f) => s + f.fileSize, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new PermitIntelError(400, `The attachments come to ${(total / 1024 / 1024).toFixed(1)} MB; an email takes up to 20 MB. Send the large files another way.`);
  const attachments: { filename: string; contentBase64: string }[] = [];
  for (const f of files) {
    try {
      attachments.push({ filename: f.fileName, contentBase64: (await readFile(f.storageKey)).toString("base64") });
    } catch {
      throw new PermitIntelError(409, `${f.fileName} is missing from the store. Upload it again or remove it.`);
    }
  }

  const sentAt = new Date();
  const claimed = await prisma.permitMessage.updateMany({ where: { id: messageId, status: "DRAFT" }, data: { status: "SENT", sentAt, sentByUserId: actor.id } });
  if (!claimed.count) throw new PermitIntelError(409, "This email has just been sent or discarded");

  let externalId: string | null = null;
  try {
    const r = await sendEmail({ to: m.toEmails, cc: m.ccEmails.length ? m.ccEmails : undefined, subject: m.subject, html: bodyHtml(m.body), text: m.body, replyTo: actor.email || undefined, attachments });
    if (!r) throw new Error("email is not set up on this server");
    externalId = r.id;
  } catch (err) {
    await prisma.permitMessage.update({ where: { id: messageId }, data: { status: "DRAFT", sentAt: null, sentByUserId: null } });
    const reason = err instanceof Error ? err.message : "send failed";
    logger.warn("permit message send failed", { messageId, reason });
    throw new PermitIntelError(409, `The email was not sent: ${reason}`);
  }

  const comm = await prisma.communication.create({
    data: {
      leadId: permit.job.leadId,
      communicationType: "EMAIL",
      direction: "OUTBOUND",
      provider: "permit",
      externalMessageId: externalId,
      fromValue: env.EMAIL_FROM || "",
      toValue: [...m.toEmails, ...m.ccEmails.map((c) => `cc ${c}`)].join(", "),
      subject: m.subject,
      body: m.body,
      status: "SENT",
      sentAt,
      createdByUserId: actor.id,
    },
    select: { id: true },
  });
  const sent = await prisma.permitMessage.update({ where: { id: messageId }, data: { communicationId: comm.id } });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: m.permitId, action: "permit_message_sent", after: { messageId, to: m.toEmails, cc: m.ccEmails, subject: m.subject, attachments: files.map((f) => f.fileName), items: m.correctionItemIds.length } });
  return sent;
}

export async function listMessages(permitId: string) {
  return prisma.permitMessage.findMany({
    where: { permitId, status: { not: "DISCARDED" } },
    orderBy: { createdAt: "desc" },
    include: { party: { select: { id: true, name: true, role: true } }, createdBy: { select: { firstName: true, lastName: true } }, sentBy: { select: { firstName: true, lastName: true } } },
  });
}
