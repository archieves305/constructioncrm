import type { ActivityType, InteractionDirection, InteractionKind, InteractionOutcome, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { createTask } from "@/lib/tasks/create";
import { pinAllDay, type DayKey } from "@/lib/time/zone";
import { PartnerError } from "./errors";
import { settlePartnerFollowUps } from "./follow-up-run";

/**
 * Logging a touch with an account. One write moves everything that depends
 * on it: the account's and the contact's `lastContactAt`, a bid lead's
 * Activity tab when the touch was about a bid (the `logCaseCommunication`
 * bridge), the optional follow-up task, and the account's open engine
 * follow-ups, which settle against the new record.
 */

export type InteractionInput = {
  contactId?: string | null;
  leadId?: string | null;
  kind: InteractionKind;
  direction?: InteractionDirection;
  outcome: InteractionOutcome;
  occurredAt?: string | Date;
  summary: string;
  followUp?: { title: string; dueDay: DayKey; assignedUserId?: string | null } | null;
};

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export const INTERACTION_SELECT = {
  id: true,
  organizationId: true,
  contactId: true,
  leadId: true,
  kind: true,
  direction: true,
  outcome: true,
  occurredAt: true,
  summary: true,
  createdAt: true,
  updatedAt: true,
  user: PERSON,
  contact: { select: { id: true, firstName: true, lastName: true, title: true } },
  lead: { select: { id: true, fullName: true, companyName: true, propertyAddress1: true, city: true } },
} satisfies Prisma.InteractionSelect;

export type InteractionRow = Prisma.InteractionGetPayload<{ select: typeof INTERACTION_SELECT }>;

const ACTIVITY_TYPE: Partial<Record<InteractionKind, ActivityType>> = { CALL: "CALL_LOGGED", EMAIL: "EMAIL_LOGGED", LINKEDIN: "EMAIL_LOGGED" };

const KIND_LABEL: Record<InteractionKind, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  SITE_VISIT: "Site visit",
  LUNCH: "Lunch",
  LINKEDIN: "LinkedIn",
  INTRO: "Introduction",
  PREQUAL_SUBMISSION: "Prequalification submitted",
  BID_DISCUSSION: "Bid discussion",
  DOC_SENT: "Documents sent",
  NOTE: "Note",
  OTHER: "Interaction",
};

function occurredAtOf(v: string | Date | undefined): Date {
  if (!v) return new Date();
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new PartnerError(400, "occurredAt: not a date");
  if (d.getTime() > Date.now() + 60 * 60_000) throw new PartnerError(400, "occurredAt: that is in the future");
  return d;
}

async function recomputeLastContact(tx: Prisma.TransactionClient, organizationId: string, contactId: string | null) {
  const last = await tx.interaction.findFirst({ where: { organizationId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  await tx.organization.update({ where: { id: organizationId }, data: { lastContactAt: last?.occurredAt ?? null } });
  if (contactId) {
    const c = await tx.interaction.findFirst({ where: { contactId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
    await tx.contact.update({ where: { id: contactId }, data: { lastContactAt: c?.occurredAt ?? null } });
  }
}

export async function logInteraction(organizationId: string, input: InteractionInput, actorUserId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, ownerUserId: true, lastContactAt: true } });
  if (!org) throw new PartnerError(404, "Account not found");
  if (input.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: input.contactId }, select: { organizationId: true } });
    if (!c || c.organizationId !== organizationId) throw new PartnerError(400, "contactId: that person is not at this account");
  }
  if (input.leadId) {
    const l = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { organizationId: true } });
    if (!l) throw new PartnerError(400, "leadId: that lead does not exist");
  }
  const occurredAt = occurredAtOf(input.occurredAt);
  const summary = input.summary.trim();

  const { interaction, taskId } = await prisma.$transaction(async (tx) => {
    const interaction = await tx.interaction.create({
      data: { organizationId, contactId: input.contactId ?? null, leadId: input.leadId ?? null, userId: actorUserId, kind: input.kind, direction: input.direction ?? "OUTBOUND", outcome: input.outcome, occurredAt, summary },
      select: INTERACTION_SELECT,
    });
    await tx.organization.update({ where: { id: organizationId }, data: { lastContactAt: org.lastContactAt && org.lastContactAt > occurredAt ? org.lastContactAt : occurredAt } });
    if (input.contactId) {
      const c = await tx.contact.findUnique({ where: { id: input.contactId }, select: { lastContactAt: true } });
      if (!c?.lastContactAt || c.lastContactAt < occurredAt) await tx.contact.update({ where: { id: input.contactId }, data: { lastContactAt: occurredAt } });
    }
    if (input.leadId) {
      await tx.activityLog.create({
        data: { leadId: input.leadId, activityType: ACTIVITY_TYPE[input.kind] ?? "NOTE", title: `${KIND_LABEL[input.kind]} with ${org.name}`, description: summary, metadataJson: { interactionId: interaction.id }, createdByUserId: actorUserId },
      });
    }
    let taskId: string | null = null;
    if (input.followUp) {
      const dueAt = pinAllDay(input.followUp.dueDay);
      const task = await createTask(
        { title: input.followUp.title.trim(), dueAt, allDay: true, assignedUserId: input.followUp.assignedUserId ?? org.ownerUserId ?? actorUserId, createdByUserId: actorUserId, organizationId, leadId: input.leadId ?? null, source: "manual" },
        { db: tx, actorUserId, notify: "after", logLeadActivity: false },
      );
      taskId = task.id;
      await tx.organization.update({ where: { id: organizationId }, data: { nextFollowUpAt: dueAt } });
    }
    return { interaction, taskId };
  });

  await recordAudit({ actorUserId, entityType: "Interaction", entityId: interaction.id, action: "create", after: { organizationId, contactId: input.contactId ?? null, leadId: input.leadId ?? null, kind: input.kind, direction: input.direction ?? "OUTBOUND", outcome: input.outcome, occurredAt, followUpTaskId: taskId } });
  await settlePartnerFollowUps(organizationId, actorUserId);
  return { interaction, taskId };
}

export async function updateInteraction(id: string, patch: Partial<Pick<InteractionInput, "contactId" | "kind" | "direction" | "outcome" | "occurredAt" | "summary">>, actor: { id: string; canAdmin: boolean }) {
  const before = await prisma.interaction.findUnique({ where: { id }, select: INTERACTION_SELECT });
  if (!before) throw new PartnerError(404, "Interaction not found");
  if (before.user.id !== actor.id && !actor.canAdmin) throw new PartnerError(403, "Only the person who logged it, or a manager, can change it");
  if (patch.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: patch.contactId }, select: { organizationId: true } });
    if (!c || c.organizationId !== before.organizationId) throw new PartnerError(400, "contactId: that person is not at this account");
  }
  const data: Prisma.InteractionUpdateInput = {};
  if (patch.kind) data.kind = patch.kind;
  if (patch.direction) data.direction = patch.direction;
  if (patch.outcome) data.outcome = patch.outcome;
  if (patch.summary !== undefined) data.summary = patch.summary.trim();
  if (patch.occurredAt !== undefined) data.occurredAt = occurredAtOf(patch.occurredAt);
  if (patch.contactId !== undefined) data.contact = patch.contactId ? { connect: { id: patch.contactId } } : { disconnect: true };
  const after = await prisma.$transaction(async (tx) => {
    const row = await tx.interaction.update({ where: { id }, data, select: INTERACTION_SELECT });
    await recomputeLastContact(tx, before.organizationId, before.contactId);
    if (row.contactId && row.contactId !== before.contactId) await recomputeLastContact(tx, before.organizationId, row.contactId);
    return row;
  });
  await recordAudit({ actorUserId: actor.id, entityType: "Interaction", entityId: id, action: "update", before: pickFrom(before, patch), after: patch });
  await settlePartnerFollowUps(before.organizationId, actor.id, "An interaction was corrected");
  return after;
}

export async function deleteInteraction(id: string, actor: { id: string; canAdmin: boolean }) {
  const before = await prisma.interaction.findUnique({ where: { id }, select: INTERACTION_SELECT });
  if (!before) throw new PartnerError(404, "Interaction not found");
  if (before.user.id !== actor.id && !actor.canAdmin) throw new PartnerError(403, "Only the person who logged it, or a manager, can delete it");
  await prisma.$transaction(async (tx) => {
    await tx.interaction.delete({ where: { id } });
    await recomputeLastContact(tx, before.organizationId, before.contactId);
  });
  await recordAudit({ actorUserId: actor.id, entityType: "Interaction", entityId: id, action: "delete", before });
  await settlePartnerFollowUps(before.organizationId, actor.id, "An interaction was removed");
}

export async function listInteractions(organizationId: string, opts: { page: number; pageSize: number; kind?: InteractionKind }) {
  const where: Prisma.InteractionWhereInput = { organizationId, ...(opts.kind ? { kind: opts.kind } : {}) };
  const [rows, total] = await Promise.all([
    prisma.interaction.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize, select: INTERACTION_SELECT }),
    prisma.interaction.count({ where }),
  ]);
  return { rows, total };
}

function pickFrom(row: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, row[k]]));
}

/** Move an account's last contact forward to `at`, never back (a back-dated touch must not make it look quieter). */
export async function advanceLastContact(tx: Prisma.TransactionClient, organizationId: string, at: Date): Promise<void> {
  await tx.organization.updateMany({ where: { id: organizationId, OR: [{ lastContactAt: null }, { lastContactAt: { lt: at } }] }, data: { lastContactAt: at } });
}
