import type { Prisma, QualificationStatus, RequirementStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { todayKey, type DayKey } from "@/lib/time/zone";
import { settleQualificationAlerts } from "./document-alert-run";
import { parseDocDay } from "./documents";
import { PartnerError } from "./errors";
import { settlePartnerFollowUps } from "./follow-up-run";
import { coverage, deriveQualificationStatus, pickRepresentative, requirementState } from "./qualification-state";
import { getPartnerSettings } from "./settings";
import { canReadDocument, type VaultViewer } from "./vault-access";

/**
 * A prequalification with an account and the checklist of documents the GC
 * asks for. The checklist starts from the default set in the settings and is
 * edited per GC; a line is satisfied by the current vault document of its
 * type, and the GC's answer (accepted / rejected / waived) is recorded on it.
 */

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export const REQUIREMENT_SELECT = {
  id: true,
  qualificationId: true,
  documentTypeId: true,
  required: true,
  status: true,
  companyDocumentId: true,
  providedAt: true,
  notes: true,
  sortOrder: true,
  documentType: { select: { id: true, key: true, name: true, category: true } },
  companyDocument: { select: { id: true, title: true, version: true, expiresAt: true, confidentiality: true, fileName: true } },
} satisfies Prisma.QualificationRequirementSelect;

export const QUAL_SELECT = {
  id: true,
  organizationId: true,
  platform: true,
  portalUrl: true,
  portalUsernameHint: true,
  ownerUserId: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  expiresAt: true,
  renewalDueAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  owner: PERSON,
  createdBy: PERSON,
  organization: { select: { id: true, name: true, stage: true, owner: PERSON } },
  requirements: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }], select: REQUIREMENT_SELECT },
} satisfies Prisma.QualificationSelect;

export type QualRow = Prisma.QualificationGetPayload<{ select: typeof QUAL_SELECT }>;

/** The wire shape: derived status, coverage, each line's state, and whether the viewer may open each attached document. */
export function presentQualification(q: QualRow, viewer: VaultViewer, today: DayKey = todayKey()) {
  const requirements = q.requirements.map((r) => ({ ...r, state: requirementState(r, today), companyDocument: r.companyDocument ? { ...r.companyDocument, locked: !canReadDocument(viewer, r.companyDocument.confidentiality) } : null }));
  return { ...q, requirements, derivedStatus: deriveQualificationStatus(q, today), coverage: coverage(q.requirements, today) };
}

export type QualificationView = ReturnType<typeof presentQualification>;

export type QualificationInput = {
  platform?: string | null;
  portalUrl?: string | null;
  portalUsernameHint?: string | null;
  ownerUserId?: string | null;
  status?: QualificationStatus;
  submittedAt?: string | null;
  approvedAt?: string | null;
  expiresAt?: string | null;
  renewalDueAt?: string | null;
  notes?: string | null;
  /** Document type keys the checklist starts with; defaults to the settings' set. */
  requirementTypeKeys?: string[];
};

const clean = (v: string | null | undefined) => v?.trim() || null;

export async function createQualification(organizationId: string, input: QualificationInput, actorUserId: string, viewer: VaultViewer) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw new PartnerError(404, "Account not found");
  const settings = await getPartnerSettings();
  const keys = input.requirementTypeKeys ?? settings.defaultRequirementTypeKeys;
  const types = keys.length ? await prisma.companyDocumentType.findMany({ where: { key: { in: keys }, isActive: true }, orderBy: { sortOrder: "asc" } }) : [];
  const status = input.status ?? "NOT_STARTED";
  const created = await prisma.qualification.create({
    data: {
      organizationId,
      platform: clean(input.platform),
      portalUrl: clean(input.portalUrl),
      portalUsernameHint: clean(input.portalUsernameHint),
      ownerUserId: input.ownerUserId ?? null,
      status,
      submittedAt: input.submittedAt ? parseDocDay(input.submittedAt, "Submitted") : status === "SUBMITTED" ? new Date() : null,
      approvedAt: input.approvedAt ? parseDocDay(input.approvedAt, "Approved") : status === "APPROVED" ? new Date() : null,
      expiresAt: parseDocDay(input.expiresAt, "Expiry date"),
      renewalDueAt: parseDocDay(input.renewalDueAt, "Renewal date"),
      notes: clean(input.notes),
      createdByUserId: actorUserId,
      requirements: { create: types.map((t, i) => ({ documentTypeId: t.id, sortOrder: i })) },
    },
    select: QUAL_SELECT,
  });
  await recordAudit({ actorUserId, entityType: "Qualification", entityId: created.id, action: "create", after: { organizationId, platform: created.platform, status, requirementTypes: types.map((t) => t.key) } });
  await settlePartnerFollowUps(organizationId, actorUserId, "A qualification was started");
  return presentQualification(created, viewer);
}

/** Months of validity a GC's approval usually carries: the longest among the required document types, else none. */
function validityMonths(q: { requirements: { required: boolean; documentType: { id: string } }[] }, types: { id: string; defaultValidityMonths: number | null }[]): number | null {
  const months = q.requirements.filter((r) => r.required).map((r) => types.find((t) => t.id === r.documentType.id)?.defaultValidityMonths ?? null).filter((m): m is number => m !== null);
  return months.length ? Math.max(...months) : null;
}

export async function updateQualification(id: string, patch: QualificationInput, actorUserId: string, viewer: VaultViewer) {
  const before = await prisma.qualification.findUnique({ where: { id }, select: QUAL_SELECT });
  if (!before) throw new PartnerError(404, "Qualification not found");
  const data: Prisma.QualificationUpdateInput = {};
  if (patch.platform !== undefined) data.platform = clean(patch.platform);
  if (patch.portalUrl !== undefined) data.portalUrl = clean(patch.portalUrl);
  if (patch.portalUsernameHint !== undefined) data.portalUsernameHint = clean(patch.portalUsernameHint);
  if (patch.notes !== undefined) data.notes = clean(patch.notes);
  if (patch.ownerUserId !== undefined) data.owner = patch.ownerUserId ? { connect: { id: patch.ownerUserId } } : { disconnect: true };
  if (patch.submittedAt !== undefined) data.submittedAt = parseDocDay(patch.submittedAt, "Submitted");
  if (patch.approvedAt !== undefined) data.approvedAt = parseDocDay(patch.approvedAt, "Approved");
  if (patch.expiresAt !== undefined) data.expiresAt = parseDocDay(patch.expiresAt, "Expiry date");
  if (patch.renewalDueAt !== undefined) data.renewalDueAt = parseDocDay(patch.renewalDueAt, "Renewal date");
  const statusChanged = patch.status !== undefined && patch.status !== before.status;
  if (statusChanged) {
    data.status = patch.status;
    if (patch.status === "SUBMITTED" && data.submittedAt === undefined && !before.submittedAt) data.submittedAt = new Date();
    if (patch.status === "APPROVED") {
      if (data.approvedAt === undefined && !before.approvedAt) data.approvedAt = new Date();
      if (data.expiresAt === undefined && !before.expiresAt) {
        const types = await prisma.companyDocumentType.findMany({ select: { id: true, defaultValidityMonths: true } });
        const months = validityMonths(before, types);
        if (months) {
          const approvedAt = (data.approvedAt as Date | undefined) ?? before.approvedAt ?? new Date();
          const d = new Date(approvedAt);
          d.setUTCMonth(d.getUTCMonth() + months);
          data.expiresAt = new Date(`${d.toISOString().slice(0, 10)}T12:00:00.000Z`);
        }
      }
    }
  }
  const after = await prisma.qualification.update({ where: { id }, data, select: QUAL_SELECT });
  await recordAudit({ actorUserId, entityType: "Qualification", entityId: id, action: statusChanged ? "qualification_status" : "update", before: { status: before.status, submittedAt: before.submittedAt, approvedAt: before.approvedAt, expiresAt: before.expiresAt, renewalDueAt: before.renewalDueAt, platform: before.platform }, after: { status: after.status, submittedAt: after.submittedAt, approvedAt: after.approvedAt, expiresAt: after.expiresAt, renewalDueAt: after.renewalDueAt, platform: after.platform } });
  await settleQualificationAlerts(before.organizationId, actorUserId);
  await settlePartnerFollowUps(before.organizationId, actorUserId, "The qualification moved");
  return presentQualification(after, viewer);
}

export async function deleteQualification(id: string, actorUserId: string) {
  const q = await prisma.qualification.findUnique({ where: { id }, select: { id: true, organizationId: true, status: true, platform: true } });
  if (!q) throw new PartnerError(404, "Qualification not found");
  if (q.status === "APPROVED") throw new PartnerError(409, "An approved qualification is a record; mark it rejected or let it expire instead");
  await prisma.qualification.delete({ where: { id } });
  await recordAudit({ actorUserId, entityType: "Qualification", entityId: id, action: "delete", before: q });
  await settleQualificationAlerts(q.organizationId, actorUserId);
  await settlePartnerFollowUps(q.organizationId, actorUserId, "The qualification was removed");
}

export type RequirementPatch = { required?: boolean; status?: RequirementStatus; companyDocumentId?: string | null; notes?: string | null };

export async function setRequirement(requirementId: string, patch: RequirementPatch, actorUserId: string, viewer: VaultViewer, qualificationId?: string) {
  const before = await prisma.qualificationRequirement.findUnique({ where: { id: requirementId }, select: { ...REQUIREMENT_SELECT, qualification: { select: { id: true, organizationId: true } } } });
  if (!before || (qualificationId && before.qualification.id !== qualificationId)) throw new PartnerError(404, "Requirement not found");
  const data: Prisma.QualificationRequirementUpdateInput = {};
  if (patch.required !== undefined) data.required = patch.required;
  if (patch.notes !== undefined) data.notes = clean(patch.notes);
  if (patch.companyDocumentId !== undefined) {
    if (patch.companyDocumentId) {
      const doc = await prisma.companyDocument.findUnique({ where: { id: patch.companyDocumentId }, select: { documentTypeId: true } });
      if (!doc) throw new PartnerError(400, "companyDocumentId: no such document");
      if (doc.documentTypeId !== before.documentTypeId) throw new PartnerError(400, "That document is not of this requirement's type");
      data.companyDocument = { connect: { id: patch.companyDocumentId } };
      data.providedAt = new Date();
    } else {
      data.companyDocument = { disconnect: true };
      data.providedAt = null;
    }
  }
  if (patch.status !== undefined) data.status = patch.status;
  const after = await prisma.qualificationRequirement.update({ where: { id: requirementId }, data, select: REQUIREMENT_SELECT });
  await recordAudit({ actorUserId, entityType: "QualificationRequirement", entityId: requirementId, action: patch.status !== undefined && patch.status !== before.status ? "requirement_decision" : "update", before: { status: before.status, required: before.required, companyDocumentId: before.companyDocumentId }, after: { status: after.status, required: after.required, companyDocumentId: after.companyDocumentId } });
  return presentQualification((await prisma.qualification.findUniqueOrThrow({ where: { id: before.qualification.id }, select: QUAL_SELECT })), viewer);
}

export async function addRequirement(qualificationId: string, documentTypeKey: string, actorUserId: string, viewer: VaultViewer) {
  const [q, type] = await Promise.all([
    prisma.qualification.findUnique({ where: { id: qualificationId }, select: { id: true, _count: { select: { requirements: true } } } }),
    prisma.companyDocumentType.findUnique({ where: { key: documentTypeKey } }),
  ]);
  if (!q) throw new PartnerError(404, "Qualification not found");
  if (!type) throw new PartnerError(400, "documentTypeKey: unknown document type");
  const exists = await prisma.qualificationRequirement.findUnique({ where: { qualificationId_documentTypeId: { qualificationId, documentTypeId: type.id } }, select: { id: true } });
  if (exists) throw new PartnerError(409, `${type.name} is already on the list`);
  const created = await prisma.qualificationRequirement.create({ data: { qualificationId, documentTypeId: type.id, sortOrder: q._count.requirements }, select: { id: true } });
  await recordAudit({ actorUserId, entityType: "QualificationRequirement", entityId: created.id, action: "create", after: { qualificationId, documentType: type.key } });
  return presentQualification(await prisma.qualification.findUniqueOrThrow({ where: { id: qualificationId }, select: QUAL_SELECT }), viewer);
}

export async function removeRequirement(requirementId: string, actorUserId: string, viewer: VaultViewer, qualificationId?: string) {
  const r = await prisma.qualificationRequirement.findUnique({ where: { id: requirementId }, select: { id: true, qualificationId: true, documentType: { select: { key: true } } } });
  if (!r || (qualificationId && r.qualificationId !== qualificationId)) throw new PartnerError(404, "Requirement not found");
  await prisma.qualificationRequirement.delete({ where: { id: requirementId } });
  await recordAudit({ actorUserId, entityType: "QualificationRequirement", entityId: requirementId, action: "delete", before: { qualificationId: r.qualificationId, documentType: r.documentType.key } });
  return presentQualification(await prisma.qualification.findUniqueOrThrow({ where: { id: r.qualificationId }, select: QUAL_SELECT }), viewer);
}

export async function qualificationsForOrganization(organizationId: string, viewer: VaultViewer) {
  const rows = await prisma.qualification.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, select: QUAL_SELECT });
  return rows.map((q) => presentQualification(q, viewer));
}

export type QualListParams = { status?: QualificationStatus; derived?: "EXPIRED" | "RENEWAL_DUE" | "EXPIRING"; expiringWithinDays?: number; ownerUserId?: string; organizationId?: string };

export async function listQualifications(params: QualListParams, viewer: VaultViewer) {
  const where: Prisma.QualificationWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.ownerUserId) where.ownerUserId = params.ownerUserId;
  if (params.organizationId) where.organizationId = params.organizationId;
  const rows = await prisma.qualification.findMany({ where, orderBy: [{ updatedAt: "desc" }], select: QUAL_SELECT, take: 500 });
  const today = todayKey();
  let views = rows.map((q) => presentQualification(q, viewer, today));
  if (params.derived === "EXPIRED") views = views.filter((v) => v.derivedStatus === "EXPIRED");
  if (params.derived === "RENEWAL_DUE") views = views.filter((v) => v.derivedStatus === "RENEWAL_DUE");
  if (params.derived === "EXPIRING" || params.expiringWithinDays) {
    const days = params.expiringWithinDays ?? 90;
    views = views.filter((v) => v.status === "APPROVED" && v.expiresAt && (Date.parse(v.expiresAt.toISOString().slice(0, 10)) - Date.parse(today)) / 86_400_000 <= days);
  }
  return views;
}

/** The qualification that speaks for each account (for badges and the follow-up rules). */
export async function representativeQualifications(organizationIds: string[]) {
  if (organizationIds.length === 0) return new Map<string, { id: string; status: QualificationStatus; submittedAt: Date | null; approvedAt: Date | null; expiresAt: Date | null; renewalDueAt: Date | null; updatedAt: Date }>();
  const rows = await prisma.qualification.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true, organizationId: true, status: true, submittedAt: true, approvedAt: true, expiresAt: true, renewalDueAt: true, updatedAt: true } });
  const byOrg = new Map<string, typeof rows>();
  for (const r of rows) byOrg.set(r.organizationId, [...(byOrg.get(r.organizationId) ?? []), r]);
  const today = todayKey();
  const out = new Map<string, (typeof rows)[number]>();
  for (const [orgId, list] of byOrg) {
    const pick = pickRepresentative(list, today);
    if (pick) out.set(orgId, pick);
  }
  return out;
}
