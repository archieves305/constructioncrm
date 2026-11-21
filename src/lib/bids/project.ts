import type { BidPlatform, BidPrimeStatus, BidProjectStage, BidScopeStatus, BidLossReason, Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { leadAccessWhere } from "@/lib/access/records";
import { PartnerError } from "@/lib/partners/errors";
import { BID_SELECT, createBid, moveLeadStage, presentBid, type BidInput } from "@/lib/partners/bids";
import { bidProjectNumber, canMovePrime, canMoveProject, canMoveScope, derivedProjectStage, opportunityOutcome, projectAddressKey, projectNameKey, projectStageNeeds } from "./states";
import { onPrimeAwarded } from "./events";
import { planhubSuggestion } from "./planhub/plan";

/**
 * PlanHub bid projects: one project, many GC opportunities (each the
 * partners module's BidInvitation + GC_BID lead), scopes per GC with their
 * own subcontract status. Every write is audited; the opportunity and the
 * project close from their scopes, never from the passage of time.
 */

type Viewer = { id: string; role: RoleName };
const clean = (v: string | null | undefined) => v?.trim() || null;
const whenOf = (v: string | null | undefined): Date | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00.000Z`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new PartnerError(400, "A date is not valid");
  return d;
};

export type ProjectInput = {
  name?: string;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  county?: string | null;
  source?: BidPlatform;
  platformRef?: string | null;
  platformUrl?: string | null;
  ownerName?: string | null;
  projectType?: string | null;
  ownerBidDueAt?: string | null;
  expectedPrimeAwardAt?: string | null;
  expectedStartAt?: string | null;
  notes?: string | null;
  ownerUserId?: string | null;
  timeZone?: string;
};

export type ProjectMatch = { id: string; number: string; name: string; matchedBy: "platform" | "address" | "name"; city: string | null };

/** Projects this one may already be: the PlanHub reference first, then the address, then the name. */
export async function findProjectMatches(input: { source?: BidPlatform; platformRef?: string | null; address1?: string | null; zipCode?: string | null; name?: string | null }, excludeId?: string): Promise<ProjectMatch[]> {
  const out = new Map<string, ProjectMatch>();
  const not = excludeId ? { NOT: { id: excludeId } } : {};
  const sel = { id: true, number: true, name: true, city: true } as const;
  if (input.platformRef?.trim()) {
    for (const p of await prisma.bidProject.findMany({ where: { source: input.source ?? "PLANHUB", platformRef: input.platformRef.trim(), ...not }, select: sel })) out.set(p.id, { ...p, matchedBy: "platform" });
  }
  const key = projectAddressKey(input.address1, input.zipCode);
  if (key) for (const p of await prisma.bidProject.findMany({ where: { addressKey: key, ...not }, select: sel })) if (!out.has(p.id)) out.set(p.id, { ...p, matchedBy: "address" });
  const nameKey = input.name ? projectNameKey(input.name) : "";
  if (nameKey.length >= 6) {
    const words = nameKey.split(" ").filter((w) => w.length > 2).slice(0, 4);
    const rows = await prisma.bidProject.findMany({ where: { AND: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })), stage: { not: "CLOSED" }, ...not }, select: sel, take: 5 });
    for (const p of rows) if (!out.has(p.id)) out.set(p.id, { ...p, matchedBy: "name" });
  }
  return [...out.values()];
}

function projectData(input: ProjectInput): Prisma.BidProjectUncheckedUpdateInput {
  const d: Prisma.BidProjectUncheckedUpdateInput = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new PartnerError(400, "name: the project needs a name");
    d.name = input.name.trim();
  }
  for (const k of ["address1", "address2", "city", "county", "platformRef", "platformUrl", "ownerName", "projectType", "notes"] as const) if (input[k] !== undefined) d[k] = clean(input[k]);
  if (input.state !== undefined) d.state = clean(input.state)?.toUpperCase() ?? null;
  if (input.zipCode !== undefined) d.zipCode = clean(input.zipCode);
  if (input.source !== undefined) d.source = input.source;
  if (input.timeZone !== undefined) d.timeZone = input.timeZone;
  if (input.ownerUserId !== undefined) d.ownerUserId = input.ownerUserId;
  for (const k of ["ownerBidDueAt", "expectedPrimeAwardAt", "expectedStartAt"] as const) {
    const v = whenOf(input[k]);
    if (v !== undefined) d[k] = v;
  }
  return d;
}

async function nextProjectNumber(db: Prisma.TransactionClient): Promise<string> {
  const rows = await db.$queryRaw<{ n: bigint | number }[]>`SELECT nextval('bid_project_number_seq') AS n`;
  return bidProjectNumber(Number(rows[0]?.n ?? 0));
}

/**
 * Create a project. A likely duplicate (same PlanHub reference, address or
 * name) is refused with the candidates unless the person says it is new
 * (`force`); a PlanHub reference already on a project is never duplicated.
 */
export async function createProject(input: ProjectInput & { name: string; scopes?: { serviceCategoryId: string; label?: string | null }[] }, actorUserId: string, force = false) {
  const matches = await findProjectMatches(input);
  if (matches.some((m) => m.matchedBy === "platform")) throw new PartnerError(409, "A project with that PlanHub reference already exists", { matches });
  if (matches.length && !force) throw new PartnerError(409, "This looks like a project already here", { matches });
  const data = projectData(input) as Prisma.BidProjectUncheckedCreateInput;
  const created = await prisma.$transaction(async (tx) => {
    const p = await tx.bidProject.create({
      data: { ...data, name: input.name.trim(), number: await nextProjectNumber(tx), addressKey: projectAddressKey(input.address1, input.zipCode), ownerUserId: input.ownerUserId ?? actorUserId, createdByUserId: actorUserId },
      select: { id: true, number: true },
    });
    if (input.scopes?.length) await addScopesTx(tx, p.id, input.scopes);
    return p;
  });
  await recordAudit({ actorUserId, entityType: "BidProject", entityId: created.id, action: "bid_project_create", after: { number: created.number, ...input, force } });
  return created;
}

async function addScopesTx(tx: Prisma.TransactionClient, projectId: string, scopes: { serviceCategoryId: string; label?: string | null }[]) {
  const cats = await tx.serviceCategory.findMany({ where: { id: { in: scopes.map((s) => s.serviceCategoryId) } }, select: { id: true, name: true } });
  const byId = new Map(cats.map((c) => [c.id, c.name]));
  const existing = await tx.bidProjectScope.count({ where: { bidProjectId: projectId } });
  let order = existing;
  for (const s of scopes) {
    const name = byId.get(s.serviceCategoryId);
    if (!name) throw new PartnerError(400, "scopes: a trade was not found");
    const label = clean(s.label) ?? name;
    await tx.bidProjectScope.upsert({ where: { bidProjectId_serviceCategoryId_label: { bidProjectId: projectId, serviceCategoryId: s.serviceCategoryId, label } }, create: { bidProjectId: projectId, serviceCategoryId: s.serviceCategoryId, label, sortOrder: order++ }, update: {} });
  }
}

export async function addScopes(projectId: string, scopes: { serviceCategoryId: string; label?: string | null }[], actorUserId: string) {
  await prisma.$transaction((tx) => addScopesTx(tx, projectId, scopes));
  await recordAudit({ actorUserId, entityType: "BidProject", entityId: projectId, action: "bid_project_scopes", after: { scopes } });
}

export async function updateProject(id: string, patch: ProjectInput, actorUserId: string) {
  const before = await prisma.bidProject.findUnique({ where: { id } });
  if (!before) throw new PartnerError(404, "Project not found");
  if (patch.platformRef?.trim() && patch.platformRef.trim() !== before.platformRef) {
    const clash = await prisma.bidProject.findFirst({ where: { source: patch.source ?? before.source, platformRef: patch.platformRef.trim(), NOT: { id } }, select: { number: true } });
    if (clash) throw new PartnerError(409, `That PlanHub reference is already on ${clash.number}`);
  }
  const data = projectData(patch);
  if (patch.address1 !== undefined || patch.zipCode !== undefined) data.addressKey = projectAddressKey(patch.address1 ?? before.address1, patch.zipCode ?? before.zipCode);
  await prisma.bidProject.update({ where: { id }, data });
  await recordAudit({ actorUserId, entityType: "BidProject", entityId: id, action: "update", before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])), after: patch });
}

/** Add a GC to the project: a new opportunity (its own GC_BID lead) bidding the chosen scopes. */
export async function addOpportunity(projectId: string, input: Omit<BidInput, "projectName"> & { organizationId: string; scopeIds: string[]; pmUserId?: string | null; purchasingContactId?: string | null; status?: "TRACKING" | "INVITED"; signalSource?: string | null }, actorUserId: string) {
  const project = await prisma.bidProject.findUnique({ where: { id: projectId }, include: { scopes: { select: { id: true, serviceCategoryId: true } } } });
  if (!project) throw new PartnerError(404, "Project not found");
  if (project.stage === "CANCELLED" || project.stage === "CLOSED") throw new PartnerError(409, "The project is closed; reopen it to add a GC");
  if (!project.address1 || !project.city || !project.zipCode) throw new PartnerError(400, "The project needs a street, city and zip before a GC can be added (the opportunity's lead carries the site)");
  const tradeIds = [...new Set(project.scopes.filter((s) => input.scopeIds.includes(s.id)).map((s) => s.serviceCategoryId))];
  const bid = await createBid(
    {
      ...input,
      projectName: project.name,
      projectType: input.projectType ?? project.projectType,
      platform: project.source,
      platformRef: input.platformRef ?? project.platformRef,
      platformUrl: input.platformUrl ?? project.platformUrl,
      tradeIds,
      bidProjectId: project.id,
      scopeIds: input.scopeIds,
      site: { address1: project.address1, address2: project.address2, city: project.city, state: project.state ?? "FL", zipCode: project.zipCode, county: project.county },
    },
    actorUserId,
  );
  return bid;
}

/** Add or drop scopes a GC is bidding (a scope with a decision is never dropped). */
export async function setOpportunityScopes(bidId: string, scopeIds: string[], actorUserId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { bidProjectId: true, status: true, scopes: { select: { id: true, scopeId: true, status: true } } } });
  if (!bid?.bidProjectId) throw new PartnerError(404, "Opportunity not found");
  if (scopeIds.length === 0) throw new PartnerError(400, "scopeIds: a GC bids at least one scope");
  const valid = await prisma.bidProjectScope.findMany({ where: { id: { in: scopeIds }, bidProjectId: bid.bidProjectId }, select: { id: true, serviceCategoryId: true } });
  if (valid.length !== scopeIds.length) throw new PartnerError(400, "scopeIds: not this project's scopes");
  const drop = bid.scopes.filter((s) => !scopeIds.includes(s.scopeId));
  if (drop.some((s) => s.status !== "PENDING")) throw new PartnerError(409, "A scope with a decision on it stays; mark it withdrawn instead");
  const add = scopeIds.filter((id) => !bid.scopes.some((s) => s.scopeId === id));
  await prisma.$transaction([
    prisma.bidOpportunityScope.deleteMany({ where: { id: { in: drop.map((s) => s.id) } } }),
    prisma.bidOpportunityScope.createMany({ data: add.map((scopeId) => ({ bidInvitationId: bidId, scopeId })) }),
  ]);
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_scopes", after: { scopeIds, added: add, dropped: drop.map((s) => s.scopeId) } });
  await syncOpportunity(bidId, actorUserId);
}

/**
 * The GC's prime contract. GC_LOST decides every open scope of this GC
 * (lost, "GC lost the prime") — and only this GC. GC_AWARDED with a scope
 * still pending asks for an urgent call.
 */
export async function setPrimeStatus(bidId: string, status: BidPrimeStatus, note: string | null | undefined, actorUserId: string) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { id: true, number: true, primeStatus: true, bidProjectId: true, scopes: { select: { status: true } } } });
  if (!bid?.bidProjectId) throw new PartnerError(404, "Opportunity not found");
  if (!canMovePrime(bid.primeStatus, status)) throw new PartnerError(409, `The prime cannot go from ${bid.primeStatus} to ${status}`);
  await prisma.bidInvitation.update({ where: { id: bidId }, data: { primeStatus: status } });
  if (status === "GC_LOST" || status === "CANCELLED") {
    await prisma.bidOpportunityScope.updateMany({ where: { bidInvitationId: bidId, status: { in: ["PENDING", "VERBAL"] } }, data: status === "GC_LOST" ? { status: "LOST", lossReason: "GC_LOST_PRIME", decidedAt: new Date() } : { status: "CANCELLED", decidedAt: new Date() } });
  }
  await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_prime", before: { primeStatus: bid.primeStatus }, after: { primeStatus: status, note: clean(note) } });
  if (status === "GC_AWARDED" && bid.scopes.some((s) => s.status === "PENDING" || s.status === "VERBAL")) await onPrimeAwarded(bidId, actorUserId);
  await syncOpportunity(bidId, actorUserId);
}

/** A scope lost, withdrawn, not bid, cancelled — or back to pending. Awards go through award.ts. */
export async function setScopeStatus(oppScopeId: string, status: Exclude<BidScopeStatus, "VERBAL" | "AWARDED" | "EXECUTED">, lossReason: BidLossReason | null | undefined, note: string | null | undefined, actorUserId: string) {
  const row = await prisma.bidOpportunityScope.findUnique({ where: { id: oppScopeId }, select: { id: true, status: true, bidInvitationId: true, awardId: true } });
  if (!row) throw new PartnerError(404, "Scope not found");
  if (!canMoveScope(row.status, status)) throw new PartnerError(409, `A scope cannot go from ${row.status} to ${status}`);
  if (status === "LOST" && !lossReason) throw new PartnerError(400, "lossReason: say why it was lost");
  await prisma.bidOpportunityScope.update({ where: { id: oppScopeId }, data: { status, lossReason: status === "LOST" ? lossReason : null, notes: clean(note), decidedAt: status === "PENDING" ? null : new Date(), awardId: status === "PENDING" ? null : row.awardId } });
  await recordAudit({ actorUserId, entityType: "BidOpportunityScope", entityId: oppScopeId, action: "bid_scope_status", before: { status: row.status }, after: { status, lossReason: lossReason ?? null, note: clean(note) } });
  await syncOpportunity(row.bidInvitationId, actorUserId);
}

/** The project's hand-set stages. CANCELLED cancels every open scope of every GC. */
export async function setProjectStage(projectId: string, stage: BidProjectStage, reason: string | null | undefined, reviewAt: string | null | undefined, actorUserId: string) {
  const p = await prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, opportunities: { select: { id: true } } } });
  if (!p) throw new PartnerError(404, "Project not found");
  if (!canMoveProject(p.stage, stage)) throw new PartnerError(409, `The project cannot go from ${p.stage} to ${stage}`);
  const needs = projectStageNeeds(stage);
  if (needs.reason && !clean(reason)) throw new PartnerError(400, "reason: say why");
  const review = whenOf(reviewAt);
  if (needs.reviewAt && !review) throw new PartnerError(400, "reviewAt: when should we look at it again?");
  await prisma.bidProject.update({ where: { id: projectId }, data: { stage, stageReason: clean(reason), stageReviewAt: review ?? null } });
  if (stage === "CANCELLED") await prisma.bidOpportunityScope.updateMany({ where: { bidInvitation: { bidProjectId: projectId }, status: { in: ["PENDING", "VERBAL"] } }, data: { status: "CANCELLED", decidedAt: new Date() } });
  await recordAudit({ actorUserId, entityType: "BidProject", entityId: projectId, action: "bid_project_stage", before: { stage: p.stage }, after: { stage, reason: clean(reason), reviewAt: review ?? null } });
  for (const o of p.opportunities) await syncOpportunity(o.id, actorUserId, { skipProject: true });
  await syncProjectStage(projectId, actorUserId);
}

/**
 * Close or reopen a GC opportunity from its scopes, mirror its lead (Won /
 * Lost / open) and then the project's stage. Idempotent: called after every
 * scope, prime or award write.
 */
export async function syncOpportunity(bidId: string, actorUserId: string, opts: { skipProject?: boolean } = {}) {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { id: true, number: true, leadId: true, status: true, outcome: true, bidProjectId: true, organizationId: true, _count: { select: { submissions: true } }, scopes: { select: { status: true, lossReason: true } }, awards: { where: { kind: { not: "VERBAL" } }, select: { amount: true } } } });
  if (!bid?.bidProjectId) return;
  const result = opportunityOutcome(bid.scopes);
  if (result.closed && (bid.status !== "CLOSED" || bid.outcome !== result.outcome)) {
    const awarded = bid.awards.reduce((s, a) => s + Number(a.amount), 0);
    await prisma.bidInvitation.update({ where: { id: bidId }, data: { status: "CLOSED", outcome: result.outcome, lossReason: result.lossReason, outcomeAt: new Date(), awardedAmount: result.outcome === "AWARDED" ? awarded : null, nextActionAt: null, nextActionLabel: null } });
    await moveLeadStage(bid.leadId, result.outcome === "AWARDED" ? "won" : "lost", actorUserId, `${bid.number}: ${result.outcome.toLowerCase().replace("_", " ")}`);
    await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_outcome", before: { status: bid.status, outcome: bid.outcome }, after: { outcome: result.outcome, lossReason: result.lossReason, awardedAmount: awarded, from: "scopes" } });
    // Nothing left to chase: the open follow-up calls and unsent drafts go with it.
    const { cancelOpenFollowUps } = await import("./follow-ups");
    await cancelOpenFollowUps(bidId, `the bid closed (${result.outcome.toLowerCase().replace("_", " ")})`, actorUserId);
  } else if (!result.closed && bid.status === "CLOSED") {
    const status = bid._count.submissions ? "SUBMITTED" : "INVITED";
    await prisma.bidInvitation.update({ where: { id: bidId }, data: { status, outcome: null, lossReason: null, outcomeAt: null, awardedAmount: null } });
    await moveLeadStage(bid.leadId, "open", actorUserId, `${bid.number} reopened`);
    await recordAudit({ actorUserId, entityType: "BidInvitation", entityId: bidId, action: "bid_reopen", before: { outcome: bid.outcome }, after: { status, from: "scopes" } });
  }
  if (!opts.skipProject) await syncProjectStage(bid.bidProjectId, actorUserId);
}

export async function syncProjectStage(projectId: string, actorUserId: string) {
  const p = await prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, opportunities: { select: { status: true, primeStatus: true } } } });
  if (!p) return;
  const next = derivedProjectStage(p.stage, p.opportunities.map((o) => ({ closed: o.status === "CLOSED", primeStatus: o.primeStatus })));
  if (next === p.stage) return;
  await prisma.bidProject.update({ where: { id: projectId }, data: { stage: next } });
  await recordAudit({ actorUserId, entityType: "BidProject", entityId: projectId, action: "bid_project_stage", before: { stage: p.stage }, after: { stage: next, from: "opportunities" } });
}

// ── Reads ────────────────────────────────────────────────────────────────

const PERSON = { select: { id: true, firstName: true, lastName: true, isActive: true } } as const;

const PROJECT_SELECT = {
  id: true,
  number: true,
  name: true,
  address1: true,
  address2: true,
  city: true,
  state: true,
  zipCode: true,
  county: true,
  timeZone: true,
  source: true,
  platformRef: true,
  platformUrl: true,
  ownerName: true,
  projectType: true,
  stage: true,
  stageReason: true,
  stageReviewAt: true,
  ownerBidDueAt: true,
  expectedPrimeAwardAt: true,
  expectedStartAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  owner: PERSON,
  planhubStage: true,
  planhubStageAt: true,
  planhubDueAt: true,
  planhubSeenAt: true,
  scopes: { orderBy: { sortOrder: "asc" as const }, select: { id: true, label: true, serviceCategoryId: true, serviceCategory: { select: { name: true } } } },
} satisfies Prisma.BidProjectSelect;

export async function getProject(id: string, viewer: Viewer) {
  const project = await prisma.bidProject.findUnique({ where: { id }, select: PROJECT_SELECT });
  if (!project) throw new PartnerError(404, "Project not found");
  const opportunities = await prisma.bidInvitation.findMany({ where: { bidProjectId: id, lead: leadAccessWhere(viewer) }, orderBy: { createdAt: "asc" }, select: { ...BID_SELECT, awards: { orderBy: { awardedAt: "asc" }, select: { id: true, kind: true, amount: true, awardedAt: true, evidenceFileId: true, notes: true, job: { select: { id: true, jobNumber: true, title: true } }, scopes: { select: { scopeId: true } } } }, lead: { select: { ...BID_SELECT.lead.select, assignedUser: PERSON } } } });
  const total = await prisma.bidInvitation.count({ where: { bidProjectId: id } });
  // An own-only role that can open none of the project's GCs does not see the project.
  if (total > 0 && opportunities.length === 0 && project.owner?.id !== viewer.id) throw new PartnerError(404, "Project not found");
  const proposals = await prisma.bidProposal.findMany({
    where: { bidProjectId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, number: true, title: true,
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, total: true, bundleAdjustment: true, proposalDate: true, validUntil: true, organizationId: true, verifiedAt: true, createdAt: true, organization: { select: { name: true } }, file: { select: { id: true, fileName: true } }, lines: { orderBy: { sortOrder: "asc" }, select: { scopeId: true, kind: true, amount: true, description: true } }, _count: { select: { submissions: true } } } },
    },
  });
  const subs = await prisma.bidSubmission.groupBy({ by: ["bidInvitationId"], where: { bidInvitation: { bidProjectId: id } }, _count: { _all: true } });
  const subsByBid = new Map(subs.map((s) => [s.bidInvitationId, s._count._all]));
  const planhub = planhubSuggestion({
    planhubStage: project.planhubStage,
    opportunities: total === 0 ? [] : opportunities.map((o) => ({ submissions: subsByBid.get(o.id) ?? 0, awards: o.awards.length, scopes: o.scopes })),
  });
  return {
    ...project,
    planhubSuggestion: planhub,
    proposals: proposals.map((p) => ({ ...p, versions: p.versions.map((v) => ({ ...v, total: v.total === null ? null : Number(v.total), bundleAdjustment: v.bundleAdjustment === null ? null : Number(v.bundleAdjustment), lines: v.lines.map((l) => ({ ...l, amount: Number(l.amount) })), submissions: v._count.submissions })) })),
    opportunities: opportunities.map((o) => ({
      ...presentBid(o),
      owner: o.lead.assignedUser,
      awards: o.awards.map((a) => ({ ...a, amount: Number(a.amount), scopeIds: a.scopes.map((s) => s.scopeId) })),
    })),
    hiddenOpportunities: total - opportunities.length,
  };
}
export type ProjectView = Awaited<ReturnType<typeof getProject>>;

export type ProjectListParams = { stage?: BidProjectStage | "active" | "all"; search?: string; ownerUserId?: string; tradeId?: string; organizationId?: string; county?: string; page: number; pageSize: number };

export async function listProjects(params: ProjectListParams, viewer: Viewer) {
  const and: Prisma.BidProjectWhereInput[] = [];
  if (params.stage === "active" || !params.stage) and.push({ stage: { in: ["OPEN", "PRIME_AWARDED", "POSTPONED", "REBIDDING"] } });
  else if (params.stage !== "all") and.push({ stage: params.stage });
  if (params.search) and.push({ OR: [{ name: { contains: params.search, mode: "insensitive" } }, { number: { contains: params.search, mode: "insensitive" } }, { address1: { contains: params.search, mode: "insensitive" } }, { city: { contains: params.search, mode: "insensitive" } }, { platformRef: { contains: params.search, mode: "insensitive" } }] });
  if (params.ownerUserId) and.push({ OR: [{ ownerUserId: params.ownerUserId }, { opportunities: { some: { lead: { assignedUserId: params.ownerUserId } } } }] });
  if (params.tradeId) and.push({ scopes: { some: { serviceCategoryId: params.tradeId } } });
  if (params.organizationId) and.push({ opportunities: { some: { organizationId: params.organizationId } } });
  if (params.county) and.push({ county: { equals: params.county, mode: "insensitive" } });
  // An own-only role sees projects it owns or where it can open a GC.
  const scoped = leadAccessWhere(viewer);
  if (Object.keys(scoped).length) and.push({ OR: [{ ownerUserId: viewer.id }, { opportunities: { some: { lead: scoped } } }] });
  const where: Prisma.BidProjectWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.bidProject.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: {
        id: true, number: true, name: true, city: true, county: true, stage: true, source: true, ownerBidDueAt: true, updatedAt: true,
        owner: PERSON,
        scopes: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true } },
        opportunities: { select: { id: true, status: true, primeStatus: true, bidDueAt: true, nextActionAt: true, organization: { select: { id: true, name: true } } } },
      },
    }),
    prisma.bidProject.count({ where }),
  ]);
  return {
    rows: rows.map((r) => {
      const open = r.opportunities.filter((o) => o.status !== "CLOSED");
      const dues = open.map((o) => o.bidDueAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime());
      const next = open.map((o) => o.nextActionAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime());
      return { ...r, gcCount: r.opportunities.length, openGcCount: open.length, nextSubDueAt: dues[0] ?? null, nextActionAt: next[0] ?? null, gcs: r.opportunities.map((o) => ({ id: o.id, name: o.organization.name, status: o.status, primeStatus: o.primeStatus })) };
    }),
    total,
  };
}

/**
 * The work queues, one row per GC opportunity on a project. Each queue is
 * one `where`, so a count and its list never disagree.
 */
export const OPPORTUNITY_QUEUES = ["mine", "deadlines", "ready", "awaiting", "gc_awarded", "unassigned", "history"] as const;
export type OpportunityQueue = (typeof OPPORTUNITY_QUEUES)[number];

export function queueWhere(queue: OpportunityQueue, viewer: Viewer, now = new Date()): Prisma.BidInvitationWhereInput {
  const onProject: Prisma.BidInvitationWhereInput = { bidProjectId: { not: null } };
  const open: Prisma.BidInvitationWhereInput = { status: { not: "CLOSED" } };
  switch (queue) {
    case "mine":
      return { ...onProject, ...open, OR: [{ lead: { assignedUserId: viewer.id } }, { estimatorUserId: viewer.id }, { pmUserId: viewer.id }] };
    case "deadlines":
      return { ...onProject, status: { in: ["TRACKING", "INVITED", "DECIDING", "ESTIMATING", "READY_TO_SUBMIT"] }, bidDueAt: { not: null, lte: new Date(now.getTime() + 14 * 86_400_000) } };
    case "ready":
      return { ...onProject, status: "READY_TO_SUBMIT" };
    case "awaiting":
      return { ...onProject, status: { in: ["SUBMITTED", "SHORTLISTED"] }, primeStatus: { in: ["UNKNOWN", "PENDING", "REBIDDING"] } };
    case "gc_awarded":
      return { ...onProject, ...open, primeStatus: "GC_AWARDED", scopes: { some: { status: { in: ["PENDING", "VERBAL"] } } } };
    case "unassigned":
      return { ...onProject, ...open, OR: [{ lead: { assignedUserId: null } }, { lead: { assignedUser: { isActive: false } } }] };
    case "history":
      return { ...onProject, status: "CLOSED" };
  }
}

export async function listOpportunities(queue: OpportunityQueue, params: { search?: string; ownerUserId?: string; tradeId?: string; organizationId?: string; page: number; pageSize: number }, viewer: Viewer) {
  const and: Prisma.BidInvitationWhereInput[] = [queueWhere(queue, viewer), { lead: leadAccessWhere(viewer) }];
  if (params.search) and.push({ OR: [{ projectName: { contains: params.search, mode: "insensitive" } }, { number: { contains: params.search, mode: "insensitive" } }, { organization: { name: { contains: params.search, mode: "insensitive" } } }, { bidProject: { number: { contains: params.search, mode: "insensitive" } } }] });
  if (params.ownerUserId) and.push({ lead: { assignedUserId: params.ownerUserId } });
  if (params.tradeId) and.push({ scopes: { some: { scope: { serviceCategoryId: params.tradeId } } } });
  if (params.organizationId) and.push({ organizationId: params.organizationId });
  const where: Prisma.BidInvitationWhereInput = { AND: and };
  const orderBy: Prisma.BidInvitationOrderByWithRelationInput[] = queue === "deadlines" ? [{ bidDueAt: "asc" }] : queue === "history" ? [{ outcomeAt: { sort: "desc", nulls: "last" } }] : [{ nextActionAt: { sort: "asc", nulls: "last" } }, { bidDueAt: { sort: "asc", nulls: "last" } }];
  const [rows, total] = await Promise.all([
    prisma.bidInvitation.findMany({ where, orderBy, skip: (params.page - 1) * params.pageSize, take: params.pageSize, select: { ...BID_SELECT, lead: { select: { ...BID_SELECT.lead.select, assignedUser: PERSON } } } }),
    prisma.bidInvitation.count({ where }),
  ]);
  return { rows: rows.map((r) => ({ ...presentBid(r), owner: r.lead.assignedUser })), total };
}

export async function queueCounts(viewer: Viewer) {
  const entries = await Promise.all(OPPORTUNITY_QUEUES.map(async (q) => [q, await prisma.bidInvitation.count({ where: { AND: [queueWhere(q, viewer), { lead: leadAccessWhere(viewer) }] } })] as const));
  return Object.fromEntries(entries) as Record<OpportunityQueue, number>;
}

export { presentBid };
