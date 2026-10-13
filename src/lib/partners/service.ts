import type { OrganizationKind, OrganizationPriority, PartnerStage, Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { updateTask } from "@/lib/tasks/update";
import { logger } from "@/lib/logger";
import { partnerPermissions } from "./access";
import { orgBadges, type OrgBadge } from "./derive";
import { PartnerError } from "./errors";
import { settlePartnerFollowUps } from "./follow-up-run";
import { buildOrgListWhere, orgOrderBy, type OrgListContext, type OrgListParams } from "./query";
import { bidFactsFor } from "./bids";
import { representativeQualifications } from "./qualifications";
import { getPartnerSettings } from "./settings";
import { stageDef, stageNeedsReason } from "./stages";

/**
 * Organizations: the strategic accounts under Business Development. Every
 * write is audited; a stage or owner change also settles the account's
 * follow-up tasks so nothing stale stays open.
 */

/** Lowercased, punctuation stripped, whitespace collapsed — the duplicate guard. */
export function normaliseNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type OrganizationInput = {
  name: string;
  kind: OrganizationKind;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  localOffices?: string | null;
  markets?: string[];
  notes?: string | null;
  ownerUserId?: string | null;
  priority?: OrganizationPriority | null;
  stage?: PartnerStage;
  potentialAnnualRevenue?: number | null;
  paymentTermsDays?: number | null;
  annualVolume?: string | null;
  companySize?: string | null;
  projectTypes?: string[];
  typicalProjectSize?: string | null;
  biddingPlatform?: string | null;
  prequalPlatform?: string | null;
  vendorRegistrationUrl?: string | null;
  requirementsNotes?: string | null;
  tradeIds?: string[];
  vendorId?: string | null;
  isActive?: boolean;
};

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

const ROW_SELECT = {
  id: true,
  name: true,
  kind: true,
  stage: true,
  priority: true,
  markets: true,
  city: true,
  isActive: true,
  lastContactAt: true,
  nextFollowUpAt: true,
  createdAt: true,
  owner: PERSON,
  trades: { select: { serviceCategory: { select: { id: true, name: true } } } },
  contacts: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" as const }, { lastName: "asc" as const }], take: 1, select: { id: true, firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true, isPrimary: true } },
  _count: { select: { interactions: true, contacts: { where: { isActive: true } }, leads: true } },
} satisfies Prisma.OrganizationSelect;

export type OrgRow = {
  id: string;
  name: string;
  kind: OrganizationKind;
  stage: PartnerStage;
  priority: OrganizationPriority | null;
  markets: string[];
  city: string | null;
  isActive: boolean;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  createdAt: Date;
  owner: { id: string; firstName: string; lastName: string } | null;
  trades: { id: string; name: string }[];
  primaryContact: { id: string; name: string; title: string | null; phone: string | null; email: string | null } | null;
  contactCount: number;
  interactionCount: number;
  nextOpenTask: { id: string; title: string; dueAt: Date | null } | null;
  badges: OrgBadge[];
};

function strip<T extends Partial<OrganizationInput>>(input: T): Omit<T, "tradeIds" | "stage"> {
  const { tradeIds, stage, ...rest } = input;
  void tradeIds;
  void stage;
  return rest;
}

function blank<T extends Record<string, unknown>>(data: T): T {
  // "" from a form means "clear it".
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === "" ? null : v])) as T;
}

async function nextOpenTasks(orgIds: string[]) {
  if (orgIds.length === 0) return new Map<string, { id: string; title: string; dueAt: Date | null }>();
  const tasks = await prisma.task.findMany({
    where: { organizationId: { in: orgIds }, status: { in: [...OPEN_TASK_STATUSES] }, activatedAt: { not: null } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: { id: true, title: true, dueAt: true, organizationId: true },
  });
  const map = new Map<string, { id: string; title: string; dueAt: Date | null }>();
  for (const t of tasks) if (t.organizationId && !map.has(t.organizationId)) map.set(t.organizationId, { id: t.id, title: t.title, dueAt: t.dueAt });
  return map;
}

export async function listOrganizations(params: OrgListParams, ctx: OrgListContext): Promise<{ rows: OrgRow[]; total: number; canManage: boolean; canAdmin: boolean }> {
  const where = buildOrgListWhere(params, ctx);
  const [rows, total, settings] = await Promise.all([
    prisma.organization.findMany({ where, orderBy: orgOrderBy(params.sort), skip: (params.page - 1) * params.pageSize, take: params.pageSize, select: ROW_SELECT }),
    prisma.organization.count({ where }),
    getPartnerSettings(),
  ]);
  const [tasks, quals, bids] = await Promise.all([nextOpenTasks(rows.map((r) => r.id)), representativeQualifications(rows.map((r) => r.id)), bidFactsFor(rows.map((r) => r.id))]);
  const now = new Date();
  const perms = partnerPermissions(ctx.user.role);
  return {
    rows: rows.map((r) => {
      const c = r.contacts[0] ?? null;
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        stage: r.stage,
        priority: r.priority,
        markets: r.markets,
        city: r.city,
        isActive: r.isActive,
        lastContactAt: r.lastContactAt,
        nextFollowUpAt: r.nextFollowUpAt,
        createdAt: r.createdAt,
        owner: r.owner,
        trades: r.trades.map((t) => t.serviceCategory),
        primaryContact: c ? { id: c.id, name: `${c.firstName} ${c.lastName}`, title: c.title, phone: c.phone ?? c.mobile, email: c.email } : null,
        contactCount: r._count.contacts,
        interactionCount: r._count.interactions,
        nextOpenTask: tasks.get(r.id) ?? null,
        badges: orgBadges({ stage: r.stage, createdAt: r.createdAt, lastContactAt: r.lastContactAt, interactionCount: r._count.interactions, qualification: quals.get(r.id) ?? null, openBidCount: bids.get(r.id)?.openBidCount, bidCount: bids.get(r.id)?.bidCount, awardedCount: bids.get(r.id)?.awardedCount }, now, { activeQuietDays: settings.activeQuietDays }),
      };
    }),
    total,
    canManage: perms.canManage,
    canAdmin: perms.canAdmin,
  };
}

const DETAIL_SELECT = {
  id: true,
  name: true,
  kind: true,
  website: true,
  phone: true,
  email: true,
  address1: true,
  address2: true,
  city: true,
  state: true,
  zipCode: true,
  localOffices: true,
  markets: true,
  notes: true,
  isActive: true,
  ownerUserId: true,
  priority: true,
  stage: true,
  stageChangedAt: true,
  lastContactAt: true,
  nextFollowUpAt: true,
  potentialAnnualRevenue: true,
  paymentTermsDays: true,
  annualVolume: true,
  companySize: true,
  projectTypes: true,
  typicalProjectSize: true,
  biddingPlatform: true,
  prequalPlatform: true,
  vendorRegistrationUrl: true,
  requirementsNotes: true,
  vendorId: true,
  createdAt: true,
  updatedAt: true,
  owner: PERSON,
  createdBy: PERSON,
  vendor: { select: { id: true, name: true } },
  trades: { select: { serviceCategory: { select: { id: true, name: true } } } },
  contacts: {
    orderBy: [{ isActive: "desc" as const }, { isPrimary: "desc" as const }, { lastName: "asc" as const }, { firstName: "asc" as const }],
    select: { id: true, firstName: true, lastName: true, title: true, roleTag: true, email: true, phone: true, mobile: true, linkedinUrl: true, office: true, geography: true, trades: true, relationshipStrength: true, influence: true, isPrimary: true, isActive: true, lastContactAt: true, notes: true },
  },
  stageHistory: { orderBy: { changedAt: "desc" as const }, take: 50, select: { id: true, fromStage: true, toStage: true, reason: true, changedAt: true, changedBy: PERSON } },
  _count: { select: { interactions: true, leads: true } },
} satisfies Prisma.OrganizationSelect;

export type OrgDetailRow = Prisma.OrganizationGetPayload<{ select: typeof DETAIL_SELECT }>;

export async function getOrganizationDetail(id: string, viewer: { id: string; role: RoleName }) {
  const [org, settings, quals, bids, projects] = await Promise.all([prisma.organization.findUnique({ where: { id }, select: DETAIL_SELECT }), getPartnerSettings(), representativeQualifications([id]), bidFactsFor([id]), prisma.job.findMany({ where: { lead: { organizationId: id } }, orderBy: { createdAt: "desc" }, select: { id: true, jobNumber: true, title: true, contractAmount: true, billingMethod: true, createdAt: true, leadId: true, currentStage: { select: { name: true, isClosed: true } } } })]);
  const jobCount = projects.length;
  if (!org) throw new PartnerError(404, "Account not found");
  const openTasks = await prisma.task.findMany({
    where: { organizationId: id, status: { in: [...OPEN_TASK_STATUSES] }, activatedAt: { not: null } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 20,
    select: { id: true, title: true, dueAt: true, priority: true, status: true, sourceKey: true, assignedTo: PERSON },
  });
  const now = new Date();
  const { trades, _count, ...rest } = org;
  return {
    organization: { ...rest, potentialAnnualRevenue: rest.potentialAnnualRevenue === null ? null : Number(rest.potentialAnnualRevenue), trades: trades.map((t) => t.serviceCategory) },
    interactionCount: _count.interactions,
    leadCount: _count.leads,
    openTasks,
    badges: orgBadges({ stage: org.stage, createdAt: org.createdAt, lastContactAt: org.lastContactAt, interactionCount: _count.interactions, qualification: quals.get(id) ?? null, openBidCount: bids.get(id)?.openBidCount, bidCount: bids.get(id)?.bidCount, awardedCount: bids.get(id)?.awardedCount, jobCount }, now, { activeQuietDays: settings.activeQuietDays }),
    bidFacts: bids.get(id) ?? { openBidCount: 0, bidCount: 0, awardedCount: 0, lastBidActivityAt: null },
    jobCount,
    projects: projects.map((j) => ({ ...j, contractAmount: Number(j.contractAmount) })),
    permissions: partnerPermissions(viewer.role),
  };
}

export type OrgDetail = Awaited<ReturnType<typeof getOrganizationDetail>>;

async function assertNameFree(name: string, exceptId?: string) {
  const nameKey = normaliseNameKey(name);
  if (!nameKey) throw new PartnerError(400, "Give the account a name");
  const clash = await prisma.organization.findUnique({ where: { nameKey }, select: { id: true, name: true } });
  if (clash && clash.id !== exceptId) throw new PartnerError(409, `"${clash.name}" is already on the list`, { organizationId: clash.id });
  return nameKey;
}

async function assertActiveUser(userId: string | null | undefined, what: string) {
  if (!userId) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!u) throw new PartnerError(400, `${what} does not exist`);
  if (!u.isActive) throw new PartnerError(400, `${what} is no longer active`);
}

export async function createOrganization(input: OrganizationInput, actorUserId: string, viewer: { id: string; role: RoleName }) {
  const nameKey = await assertNameFree(input.name);
  await assertActiveUser(input.ownerUserId, "The owner");
  const stage = input.stage ?? "TARGET";
  const data = blank(strip(input));
  const created = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { ...data, name: input.name.trim(), nameKey, stage, createdByUserId: actorUserId, trades: input.tradeIds?.length ? { create: input.tradeIds.map((serviceCategoryId) => ({ serviceCategoryId })) } : undefined },
      select: { id: true, name: true, stage: true },
    });
    await tx.partnerStageHistory.create({ data: { organizationId: org.id, fromStage: null, toStage: stage, changedByUserId: actorUserId } });
    return org;
  });
  await recordAudit({ actorUserId, entityType: "Organization", entityId: created.id, action: "create", after: { ...data, name: created.name, stage, tradeIds: input.tradeIds ?? [] } });
  return getOrganizationDetail(created.id, viewer);
}

export async function updateOrganization(id: string, patch: Partial<OrganizationInput>, actorUserId: string, viewer: { id: string; role: RoleName }) {
  const before = await prisma.organization.findUnique({ where: { id }, select: { ...DETAIL_SELECT, trades: { select: { serviceCategoryId: true } } } });
  if (!before) throw new PartnerError(404, "Account not found");
  const nameKey = patch.name !== undefined ? await assertNameFree(patch.name, id) : undefined;
  if (patch.ownerUserId !== undefined) await assertActiveUser(patch.ownerUserId, "The owner");
  const data = blank(strip(patch));
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id },
      data: { ...data, ...(patch.name !== undefined ? { name: patch.name.trim(), nameKey } : {}) },
    });
    if (patch.tradeIds) {
      await tx.organizationTrade.deleteMany({ where: { organizationId: id } });
      if (patch.tradeIds.length) await tx.organizationTrade.createMany({ data: patch.tradeIds.map((serviceCategoryId) => ({ organizationId: id, serviceCategoryId })) });
    }
  });
  const changedKeys = Object.keys(patch) as (keyof OrganizationInput)[];
  const beforeSlice = Object.fromEntries(changedKeys.map((k) => [k, k === "tradeIds" ? before.trades.map((t) => t.serviceCategoryId) : (before as Record<string, unknown>)[k]]));
  await recordAudit({ actorUserId, entityType: "Organization", entityId: id, action: "update", before: beforeSlice, after: patch });
  if (patch.ownerUserId !== undefined && patch.ownerUserId !== before.ownerUserId) await reassignOpenFollowUps(id, patch.ownerUserId, actorUserId);
  return getOrganizationDetail(id, viewer);
}

export async function changeStage(id: string, stage: PartnerStage, reason: string | null | undefined, actorUserId: string, viewer: { id: string; role: RoleName }) {
  const org = await prisma.organization.findUnique({ where: { id }, select: { stage: true, name: true } });
  if (!org) throw new PartnerError(404, "Account not found");
  if (stageNeedsReason(stage) && !reason?.trim()) throw new PartnerError(400, "Say why the account is not being pursued");
  if (org.stage !== stage) {
    await prisma.$transaction([
      prisma.organization.update({ where: { id }, data: { stage, stageChangedAt: new Date() } }),
      prisma.partnerStageHistory.create({ data: { organizationId: id, fromStage: org.stage, toStage: stage, reason: reason?.trim() || null, changedByUserId: actorUserId } }),
    ]);
    await recordAudit({ actorUserId, entityType: "Organization", entityId: id, action: "stage_change", before: { stage: org.stage }, after: { stage, reason: reason ?? null } });
    await settlePartnerFollowUps(id, actorUserId, `${org.name} moved to ${stageDef(stage).name}`);
  }
  return getOrganizationDetail(id, viewer);
}

export async function changeOwner(id: string, ownerUserId: string | null, actorUserId: string, viewer: { id: string; role: RoleName }) {
  const org = await prisma.organization.findUnique({ where: { id }, select: { ownerUserId: true } });
  if (!org) throw new PartnerError(404, "Account not found");
  await assertActiveUser(ownerUserId, "The owner");
  if (org.ownerUserId !== ownerUserId) {
    await prisma.organization.update({ where: { id }, data: { ownerUserId } });
    await recordAudit({ actorUserId, entityType: "Organization", entityId: id, action: "owner_change", before: { ownerUserId: org.ownerUserId }, after: { ownerUserId } });
    await reassignOpenFollowUps(id, ownerUserId, actorUserId);
  }
  return getOrganizationDetail(id, viewer);
}

/** The account's open engine follow-ups go to whoever owns it now; a hand-made task keeps its person. */
async function reassignOpenFollowUps(organizationId: string, ownerUserId: string | null, actorUserId: string) {
  if (!ownerUserId) return;
  const open = await prisma.task.findMany({ where: { organizationId, sourceKey: { startsWith: `org:${organizationId}:followup:` }, status: { in: [...OPEN_TASK_STATUSES] }, NOT: { assignedUserId: ownerUserId } }, select: { id: true } });
  for (const t of open) {
    try {
      await updateTask({ id: t.id, input: { assignedUserId: ownerUserId }, actorUserId, notify: "after" });
    } catch (err) {
      logger.exception(err, { where: "partners.reassignOpenFollowUps", taskId: t.id });
    }
  }
}

export async function deleteOrganization(id: string, actorUserId: string) {
  const org = await prisma.organization.findUnique({ where: { id }, select: { ...DETAIL_SELECT, _count: { select: { leads: true, interactions: true, contacts: true, tasks: true } } } });
  if (!org) throw new PartnerError(404, "Account not found");
  if (org._count.leads > 0) throw new PartnerError(409, "This account has leads or bids attached; mark it Do not pursue instead", { blockers: { leads: org._count.leads } });
  await prisma.$transaction([
    prisma.task.updateMany({ where: { organizationId: id, status: { in: [...OPEN_TASK_STATUSES] }, sourceKey: { startsWith: `org:${id}:followup:` } }, data: { status: "CANCELLED", skipReason: "The account was deleted" } }),
    prisma.organization.delete({ where: { id } }),
  ]);
  await recordAudit({ actorUserId, entityType: "Organization", entityId: id, action: "delete", before: { ...org, counts: org._count } });
}
