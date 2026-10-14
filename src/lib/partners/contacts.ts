import type { ContactRole, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { PartnerError } from "./errors";
import { buildContactListWhere, type ContactListParams } from "./query";

/** People at an account. One primary per account: making another primary clears the old one. */

export type ContactInput = {
  firstName: string;
  lastName: string;
  title?: string | null;
  roleTag?: ContactRole;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  linkedinUrl?: string | null;
  office?: string | null;
  geography?: string | null;
  trades?: string[];
  relationshipStrength?: number | null;
  influence?: number | null;
  isPrimary?: boolean;
  notes?: string | null;
  isActive?: boolean;
};

export const CONTACT_SELECT = {
  id: true,
  organizationId: true,
  firstName: true,
  lastName: true,
  title: true,
  roleTag: true,
  email: true,
  phone: true,
  mobile: true,
  linkedinUrl: true,
  office: true,
  geography: true,
  trades: true,
  relationshipStrength: true,
  influence: true,
  isPrimary: true,
  isActive: true,
  lastContactAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContactSelect;

function blank<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === "" ? null : v])) as T;
}

export async function createContact(organizationId: string, input: ContactInput, actorUserId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw new PartnerError(404, "Account not found");
  const data = blank({ ...input, firstName: input.firstName.trim(), lastName: input.lastName.trim() });
  const contact = await prisma.$transaction(async (tx) => {
    if (data.isPrimary) await tx.contact.updateMany({ where: { organizationId, isPrimary: true }, data: { isPrimary: false } });
    return tx.contact.create({ data: { ...data, organizationId, createdByUserId: actorUserId }, select: CONTACT_SELECT });
  });
  await recordAudit({ actorUserId, entityType: "Contact", entityId: contact.id, action: "create", after: { ...data, organizationId } });
  return contact;
}

export async function updateContact(id: string, patch: Partial<ContactInput>, actorUserId: string) {
  const before = await prisma.contact.findUnique({ where: { id }, select: CONTACT_SELECT });
  if (!before) throw new PartnerError(404, "Contact not found");
  const data = blank({ ...patch });
  if (data.firstName !== undefined) data.firstName = String(data.firstName).trim();
  if (data.lastName !== undefined) data.lastName = String(data.lastName).trim();
  const contact = await prisma.$transaction(async (tx) => {
    if (data.isPrimary) await tx.contact.updateMany({ where: { organizationId: before.organizationId, isPrimary: true, NOT: { id } }, data: { isPrimary: false } });
    return tx.contact.update({ where: { id }, data, select: CONTACT_SELECT });
  });
  const keys = Object.keys(patch) as (keyof ContactInput)[];
  await recordAudit({ actorUserId, entityType: "Contact", entityId: id, action: patch.isActive === false ? "deactivate" : "update", before: Object.fromEntries(keys.map((k) => [k, before[k as keyof typeof before]])), after: patch });
  return contact;
}

export async function listContacts(params: ContactListParams) {
  const where = buildContactListWhere(params);
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: { ...CONTACT_SELECT, organization: { select: { id: true, name: true, stage: true, owner: { select: { id: true, firstName: true, lastName: true } } } } },
    }),
    prisma.contact.count({ where }),
  ]);
  return { rows, total };
}
