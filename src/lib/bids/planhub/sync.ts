import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { PartnerError } from "@/lib/partners/errors";
import { matchAccount, normalizeName } from "@/lib/partners/itb-parse";
import { createOrganization } from "@/lib/partners/service";
import { createContact } from "@/lib/partners/contacts";
import { addOpportunity, addScopes, createProject, findProjectMatches, updateProject } from "../project";
import { readPage, splitAddress, splitPersonName, type BoardCard, type PlanhubPayload, type ProjectPage, type ProjectPageGc } from "./parse";
import { boardUpdate, dueInstant, planBoard, projectFills, tradeMatches, type BoardProjectCandidate, type BoardRow, type FillField } from "./plan";

/**
 * "Send to CRM" from a PlanHub page. `readSnapshot` keeps what was on the
 * screen and returns what applying it would do; nothing else is written until
 * a person applies it (`applyBoard` / `applyProject`). No password, no
 * session and no request to PlanHub ever leaves the CRM: the person's own
 * browser sent the page.
 */

type Viewer = { id: string; role: RoleName };
const MAX_TEXT = 400_000;

export type ProjectPlan = {
  page: ProjectPage;
  match: { id: string; number: string; name: string; how: string } | null;
  candidates: { id: string; number: string; name: string; how: string }[];
  current: { name: string; address1: string | null; city: string | null; state: string | null; zipCode: string | null; projectType: string | null; scopeTradeIds: string[] } | null;
  fills: { field: FillField; to: string }[];
  trades: { trade: string; serviceCategoryId: string | null }[];
  /** One row per GC on the page, in the page's order (`index` = position in `page.gcs`). */
  gcs: {
    index: number;
    match: { organizationId: string; name: string; how: string } | null;
    contactId: string | null;
    onProject: { bidId: string; number: string } | null;
  }[];
};

export type ReadResult =
  | { snapshotId: string; kind: "BOARD"; rows: BoardRow[] }
  | { snapshotId: string; kind: "PROJECT"; plan: ProjectPlan };

async function boardCandidates(): Promise<BoardProjectCandidate[]> {
  return prisma.bidProject.findMany({ where: { source: "PLANHUB" }, select: { id: true, number: true, name: true, planhubName: true, planhubStage: true, planhubDueAt: true } });
}

async function accountCandidates() {
  return prisma.organization.findMany({ where: { isActive: true }, select: { id: true, name: true, website: true, email: true, contacts: { where: { isActive: true }, select: { id: true, email: true } } } });
}

async function planProject(page: ProjectPage): Promise<ProjectPlan> {
  const byName = page.name
    ? (await boardCandidates()).filter((p) => (p.planhubName && normalizeName(p.planhubName) === normalizeName(page.name)) || normalizeName(p.name) === normalizeName(page.name))
    : [];
  const found = await findProjectMatches({ source: "PLANHUB", platformRef: page.platformRef, address1: page.address?.address1, zipCode: page.address?.zipCode, name: page.name });
  const candidates = new Map<string, { id: string; number: string; name: string; how: string }>();
  for (const m of found.filter((f) => f.matchedBy === "platform")) candidates.set(m.id, { id: m.id, number: m.number, name: m.name, how: "PlanHub number" });
  for (const m of byName) if (!candidates.has(m.id)) candidates.set(m.id, { id: m.id, number: m.number, name: m.name, how: "Bid Board name" });
  for (const m of found) if (!candidates.has(m.id)) candidates.set(m.id, { id: m.id, number: m.number, name: m.name, how: m.matchedBy });
  const list = [...candidates.values()];
  const sure = list.find((c) => c.how === "PlanHub number") ?? (list.filter((c) => c.how === "Bid Board name").length === 1 ? list.find((c) => c.how === "Bid Board name")! : null);

  const current = sure ? await prisma.bidProject.findUnique({ where: { id: sure.id }, select: { name: true, address1: true, city: true, state: true, zipCode: true, projectType: true, platformRef: true, platformUrl: true, scopes: { select: { serviceCategoryId: true } } } }) : null;
  const categories = await prisma.serviceCategory.findMany({ where: { isActive: true }, select: { id: true, name: true } });

  const accounts = page.gcs.length ? await accountCandidates() : [];
  const onProjectRows = sure ? await prisma.bidInvitation.findMany({ where: { bidProjectId: sure.id }, select: { id: true, number: true, organizationId: true } }) : [];
  const gcs: ProjectPlan["gcs"] = page.gcs.map((g, index) => {
    const hit = matchAccount({ originalFrom: { name: null, email: null }, contactEmail: g.contactEmail, gcName: g.name }, accounts);
    const org = hit ? accounts.find((a) => a.id === hit.organizationId) : null;
    const on = hit ? onProjectRows.find((b) => b.organizationId === hit.organizationId) : null;
    return { index, match: org ? { organizationId: org.id, name: org.name, how: hit!.how } : null, contactId: hit?.contactId ?? null, onProject: on ? { bidId: on.id, number: on.number } : null };
  });
  return {
    page,
    match: sure,
    candidates: list,
    current: current ? { name: current.name, address1: current.address1, city: current.city, state: current.state, zipCode: current.zipCode, projectType: current.projectType, scopeTradeIds: current.scopes.map((s) => s.serviceCategoryId) } : null,
    fills: projectFills(page, current),
    trades: tradeMatches(page.trades, categories),
    gcs,
  };
}

/** Keep what the browser sent and say what applying it would do. Writes only the snapshot. */
export async function readSnapshot(payload: PlanhubPayload, viewer: Viewer, now = new Date()): Promise<ReadResult> {
  if (payload.text.length > MAX_TEXT) throw new PartnerError(413, "The page is too large to read");
  const read = readPage(payload, now);
  if (read.kind === "UNKNOWN") throw new PartnerError(422, read.reason);
  const parsed = read.kind === "BOARD" ? { cards: read.cards } : { project: read.project };
  const snap = await prisma.planhubSnapshot.create({
    data: { kind: read.kind, url: payload.url.slice(0, 2000), text: payload.cards?.length ? payload.cards.map((c) => `[${c.column ?? ""}]\n${c.text}`).join("\n\n") : payload.text, parsed: parsed as unknown as Prisma.InputJsonValue, createdByUserId: viewer.id },
    select: { id: true },
  });
  if (read.kind === "BOARD") return { snapshotId: snap.id, kind: "BOARD", rows: planBoard(read.cards, await boardCandidates()) };
  return { snapshotId: snap.id, kind: "PROJECT", plan: await planProject(read.project) };
}

async function openSnapshot(id: string, viewer: Viewer, kind: "BOARD" | "PROJECT") {
  const s = await prisma.planhubSnapshot.findUnique({ where: { id }, select: { id: true, kind: true, parsed: true, appliedAt: true, createdByUserId: true } });
  if (!s || s.kind !== kind) throw new PartnerError(404, "That PlanHub page was not found; click Send to CRM again");
  if (s.createdByUserId !== viewer.id) throw new PartnerError(404, "That PlanHub page was not found; click Send to CRM again");
  if (s.appliedAt) throw new PartnerError(409, "This page was already applied; click Send to CRM again for the latest");
  return s;
}

export type BoardApply = { snapshotId: string; rows: { index: number; projectId: string | "new" }[] };

/** The ticked board cards: a new project, or PlanHub's column / due date / name on the chosen one. */
export async function applyBoard(input: BoardApply, viewer: Viewer, now = new Date()) {
  const snap = await openSnapshot(input.snapshotId, viewer, "BOARD");
  const cards = (snap.parsed as unknown as { cards: BoardCard[] }).cards;
  const applied: { index: number; projectId: string; created: boolean }[] = [];
  for (const r of input.rows) {
    const card = cards[r.index];
    if (!card) throw new PartnerError(400, "rows: a card is not on that page");
    if (r.projectId === "new") {
      const p = await createProject({ name: card.name, source: "PLANHUB" }, viewer.id, true);
      await prisma.bidProject.update({ where: { id: p.id }, data: { planhubName: card.name, planhubStage: card.stage, planhubStageAt: card.stage ? now : null, planhubDueAt: card.dueOn ? dueInstant(card.dueOn) : null, planhubSeenAt: now } });
      applied.push({ index: r.index, projectId: p.id, created: true });
    } else {
      const p = await prisma.bidProject.findUnique({ where: { id: r.projectId }, select: { id: true, planhubName: true, planhubStage: true, planhubDueAt: true } });
      if (!p) throw new PartnerError(400, "rows: a project was not found");
      const data = boardUpdate(card, p, now);
      await prisma.bidProject.update({ where: { id: p.id }, data });
      if (data.planhubStage || data.planhubDueAt) await recordAudit({ actorUserId: viewer.id, entityType: "BidProject", entityId: p.id, action: "planhub_board", before: { planhubStage: p.planhubStage, planhubDueAt: p.planhubDueAt }, after: { planhubStage: data.planhubStage ?? p.planhubStage, planhubDueAt: data.planhubDueAt ?? p.planhubDueAt, snapshotId: snap.id } });
      applied.push({ index: r.index, projectId: p.id, created: false });
    }
  }
  await prisma.planhubSnapshot.update({ where: { id: snap.id }, data: { appliedAt: now, applied: applied as unknown as Prisma.InputJsonValue } });
  return { applied: applied.length, created: applied.filter((a) => a.created).length };
}

export type ProjectApply = {
  snapshotId: string;
  projectId: string | "new";
  project: { name: string; address1: string | null; city: string | null; state: string | null; zipCode: string | null };
  scopeTradeIds: string[];
  /** The GCs to add, by their position on the page; a GC left out is not added. */
  gcs: { index: number; organizationId: string | "new"; addContact: boolean }[];
};

/**
 * A project page: fill the project's blanks (a person's values stay), add the
 * ticked scopes, and add the GC (a new account when asked) with the page's
 * contact as a GC opportunity due when PlanHub says.
 */
export async function applyProject(input: ProjectApply, viewer: Viewer, now = new Date()) {
  const snap = await openSnapshot(input.snapshotId, viewer, "PROJECT");
  const page = (snap.parsed as unknown as { project: ProjectPage }).project;
  const edited = { ...page, name: input.project.name.trim() || page.name, address: { ...page.address, text: page.address?.text ?? "", address1: input.project.address1, city: input.project.city, state: input.project.state, zipCode: input.project.zipCode } };

  let projectId: string;
  let created = false;
  if (input.projectId === "new") {
    if (!edited.name) throw new PartnerError(400, "project.name: the project needs a name");
    const p = await createProject(
      { name: edited.name, source: "PLANHUB", platformRef: page.platformRef, platformUrl: page.platformUrl, address1: edited.address.address1, city: edited.address.city, state: edited.address.state, zipCode: edited.address.zipCode, projectType: page.projectType, notes: page.description },
      viewer.id,
      true,
    );
    projectId = p.id;
    created = true;
  } else {
    const cur = await prisma.bidProject.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, address1: true, city: true, state: true, zipCode: true, projectType: true, platformRef: true, platformUrl: true, notes: true } });
    if (!cur) throw new PartnerError(400, "projectId: the project was not found");
    projectId = cur.id;
    const fills = projectFills(edited, cur);
    const patch: Record<string, string> = Object.fromEntries(fills.map((f) => [f.field, f.to]));
    if (!cur.notes && page.description) patch.notes = page.description;
    if (Object.keys(patch).length) await updateProject(projectId, { ...patch, source: "PLANHUB" }, viewer.id);
  }
  await prisma.bidProject.update({ where: { id: projectId }, data: { ...(created && page.name ? { planhubName: page.name } : {}), planhubSeenAt: now, ...(page.bidDueAt ? { planhubDueAt: new Date(page.bidDueAt) } : {}) } });

  if (input.scopeTradeIds.length) {
    const have = await prisma.bidProjectScope.findMany({ where: { bidProjectId: projectId }, select: { serviceCategoryId: true } });
    const add = input.scopeTradeIds.filter((t) => !have.some((h) => h.serviceCategoryId === t));
    if (add.length) await addScopes(projectId, add.map((serviceCategoryId) => ({ serviceCategoryId })), viewer.id);
  }

  const bids: { id: string; number: string; organizationId: string; created: boolean }[] = [];
  for (const choice of input.gcs) {
    const gc = page.gcs[choice.index];
    if (!gc) throw new PartnerError(400, "gcs: a GC is not on that page");
    bids.push(await addGc(projectId, page, gc, choice, input.scopeTradeIds, viewer));
  }
  const bid = bids[0] ?? null;
  await prisma.planhubSnapshot.update({ where: { id: snap.id }, data: { appliedAt: now, applied: { projectId, created, bids } as unknown as Prisma.InputJsonValue } });
  await recordAudit({ actorUserId: viewer.id, entityType: "BidProject", entityId: projectId, action: "planhub_project", after: { snapshotId: snap.id, platformRef: page.platformRef, created, bids } });
  return { projectId, created, bid, bids };
}

/**
 * One GC from the page onto the project: its account (new when asked — with
 * the page's email and phone on it when PlanHub names no person), a contact
 * when the page names one, and an opportunity due at this GC's own time. A GC
 * already on the project gets only a missing due date.
 */
async function addGc(projectId: string, page: ProjectPage, gc: ProjectPageGc, choice: { organizationId: string | "new"; addContact: boolean }, scopeTradeIds: string[], viewer: Viewer) {
  const person = splitPersonName(gc.contactName);
  let orgId: string;
  if (choice.organizationId === "new") {
    const a = splitAddress(gc.addressText);
    const org = await createOrganization({ name: gc.name, kind: "GENERAL_CONTRACTOR", website: gc.website, phone: gc.contactPhone, email: person ? null : gc.contactEmail, address1: a?.address1 ?? null, city: a?.city ?? null, state: a?.state ?? null, zipCode: a?.zipCode ?? null, ownerUserId: viewer.id, notes: "Added from PlanHub" }, viewer.id, viewer);
    orgId = org.organization.id;
  } else {
    orgId = choice.organizationId;
  }
  let contactId: string | null = null;
  if (gc.contactEmail) contactId = (await prisma.contact.findFirst({ where: { organizationId: orgId, email: { equals: gc.contactEmail, mode: "insensitive" } }, select: { id: true } }))?.id ?? null;
  if (!contactId && choice.addContact && person) {
    const c = await createContact(orgId, { ...person, email: gc.contactEmail, phone: gc.contactPhone, roleTag: "ESTIMATOR" }, viewer.id);
    contactId = c.id;
  }
  const due = gc.bidDueAt ?? page.bidDueAt;
  const existing = await prisma.bidInvitation.findFirst({ where: { bidProjectId: projectId, organizationId: orgId }, select: { id: true, number: true, bidDueAt: true } });
  if (existing) {
    if (due && !existing.bidDueAt) await prisma.bidInvitation.update({ where: { id: existing.id }, data: { bidDueAt: new Date(due) } });
    return { id: existing.id, number: existing.number, organizationId: orgId, created: false };
  }
  const scopes = await prisma.bidProjectScope.findMany({ where: { bidProjectId: projectId, ...(scopeTradeIds.length ? { serviceCategoryId: { in: scopeTradeIds } } : {}) }, select: { id: true } });
  if (!scopes.length) throw new PartnerError(400, "scopeTradeIds: tick at least one trade KNU is pricing, so the GC has a scope to bid");
  const b = await addOpportunity(projectId, { organizationId: orgId, contactId, scopeIds: scopes.map((s) => s.id), status: "TRACKING", bidDueAt: due, prevailingWage: page.prevailingWage ?? undefined, signalSource: "planhub:send", platformRef: page.platformRef, platformUrl: page.platformUrl }, viewer.id);
  return { id: b.id, number: b.number, organizationId: orgId, created: true };
}
