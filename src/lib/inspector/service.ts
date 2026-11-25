import type { Prisma, QualityFindingKind, QualityInspectionKind, QualitySeverity, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit/record";
import { jobLabel, JOB_LABEL_SELECT } from "@/lib/labels";
import { resolveJobFieldAccess, type FieldAccess } from "@/lib/labor/permissions";
import { jobsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { updateTask } from "@/lib/tasks/update";
import { createFieldIssue } from "@/lib/field-issues/create";
import { canStartInspection, canStartWithoutJob, inspectionRights, isOffice, type InspectionRights } from "./access";
import { cleanBox, parseBoxes, type Box } from "./boxes";
import { defaultProfile, INSPECTION_KINDS, isQualityProfile, isTradeKey, KIND_LABEL, PROFILE_LABEL, QUALITY_PROFILES, TRADES, tradeLabel, type InspectionKind } from "./catalog";
import { contractorName, scopeFromContract } from "./scope";
import { acceptBlockers, DISMISS_REASONS, findingResolved, phaseOf, PHASE_LABEL, priorityFor, SEVERITY_ORDER, type InspectionFacts, type Severity, type Verdict } from "./state";

/**
 * The inspection record (Phase 1): start, attach, areas, review, punch
 * items, accept. The AI side is `analyze.ts`. Every write checks
 * `inspectionRights`; a record the viewer may not see answers 404.
 */
export class InspectorError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "InspectorError";
  }
}

export function inspectorEnabled(): boolean {
  return env.INSPECTOR_ENABLED === "1";
}

type Viewer = { id: string; role: RoleName };

const SCOPE_SELECT = {
  id: true,
  status: true,
  startedByUserId: true,
  jobId: true,
  job: { select: { projectManagerId: true, salesRepId: true } },
} satisfies Prisma.QualityInspectionSelect;

type Scoped = Prisma.QualityInspectionGetPayload<{ select: typeof SCOPE_SELECT }>;

async function fieldAccessOn(viewer: Viewer, jobId: string | null): Promise<FieldAccess | null> {
  if (!jobId) return null;
  return (await resolveJobFieldAccess(viewer, jobId)).access;
}

/** The inspection and what this viewer may do with it; 404 when they may not see it. */
export async function scopeFor(viewer: Viewer, inspectionId: string): Promise<{ insp: Scoped; rights: InspectionRights }> {
  const insp = await prisma.qualityInspection.findUnique({ where: { id: inspectionId }, select: SCOPE_SELECT });
  if (!insp) throw new InspectorError(404, "Inspection not found");
  const rights = inspectionRights(viewer, insp, await fieldAccessOn(viewer, insp.jobId));
  if (!rights.canView) throw new InspectorError(404, "Inspection not found");
  return { insp, rights };
}

function need(ok: boolean, message: string): void {
  if (!ok) throw new InspectorError(403, message);
}

/** May this viewer start an inspection on this job (or with none)? */
async function checkStart(viewer: Viewer, jobId: string | null): Promise<{ jobType: string | null; ownedPurpose: string | null } | null> {
  need(canStartInspection(viewer.role), "Your role cannot start inspections.");
  if (!jobId) {
    need(canStartWithoutJob(viewer.role), "Start the inspection from a job you are on.");
    return null;
  }
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, jobType: true, ownedPurpose: true, projectManagerId: true, salesRepId: true } });
  if (!job) throw new InspectorError(404, "Job not found");
  const access = await fieldAccessOn(viewer, jobId);
  const rights = inspectionRights(viewer, { startedByUserId: "", status: "OPEN", job }, access);
  if (!rights.canView) throw new InspectorError(404, "Job not found");
  need(rights.canAddPhotos || job.projectManagerId === viewer.id, "You cannot take inspection photos on this job.");
  return { jobType: job.jobType, ownedPurpose: job.ownedPurpose };
}

async function checkContract(laborContractId: string | null | undefined, jobId: string | null): Promise<{ description: string | null; tasks: { name: string; room: string | null; description: string | null }[] } | null> {
  if (!laborContractId) return null;
  const c = await prisma.laborContract.findUnique({
    where: { id: laborContractId },
    select: { jobId: true, description: true, tasks: { orderBy: { sortOrder: "asc" }, select: { name: true, room: true, description: true } } },
  });
  if (!c) throw new InspectorError(404, "Labor contract not found");
  if (c.jobId !== jobId) throw new InspectorError(400, "That labor contract belongs to another job");
  return c;
}

async function nextNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ n: bigint | number }[]>`SELECT nextval('quality_inspection_number_seq') AS n`;
  return `INS-${String(Number(rows[0].n)).padStart(5, "0")}`;
}

const CLIENT_ID_RE = /^[a-z][a-z0-9]{19,31}$/;

export type CreateInput = {
  id?: string;
  kind: InspectionKind;
  jobId?: string | null;
  laborContractId?: string | null;
  addressText?: string | null;
  title?: string | null;
  scopeText?: string | null;
  qualityProfile?: string | null;
  areas?: { name: string; trade?: string | null }[];
};

export async function createInspection(viewer: Viewer, input: CreateInput): Promise<{ id: string; created: boolean }> {
  if (input.id) {
    if (!CLIENT_ID_RE.test(input.id)) throw new InspectorError(400, "Bad id");
    const existing = await prisma.qualityInspection.findUnique({ where: { id: input.id }, select: { id: true, startedByUserId: true } });
    if (existing) {
      if (existing.startedByUserId !== viewer.id) throw new InspectorError(409, "That id is already used", "id_taken");
      return { id: existing.id, created: false };
    }
  }
  const jobId = input.jobId || null;
  const job = await checkStart(viewer, jobId);
  const contract = await checkContract(input.laborContractId, jobId);
  const profile = isQualityProfile(input.qualityProfile) ? input.qualityProfile : defaultProfile(job);
  const scopeText = input.scopeText?.trim() || (contract ? scopeFromContract(contract) : null);
  if (!jobId && !input.addressText?.trim()) throw new InspectorError(400, "Give the address, or start from a job");
  const areaNames = uniqueAreas(input.areas ?? []);
  const jobAreas = jobId && areaNames.length ? await prisma.jobArea.findMany({ where: { jobId, isActive: true }, select: { id: true, name: true } }) : [];

  const created = await prisma.qualityInspection.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      number: await nextNumber(),
      kind: input.kind as QualityInspectionKind,
      jobId,
      laborContractId: input.laborContractId || null,
      addressText: input.addressText?.trim() || null,
      title: input.title?.trim() || null,
      scopeText,
      qualityProfile: profile,
      startedByUserId: viewer.id,
      areas: {
        create: areaNames.map((a, i) => ({
          name: a.name,
          trade: a.trade,
          sortOrder: i,
          jobAreaId: jobAreas.find((j) => j.name.toLowerCase() === a.name.toLowerCase())?.id ?? null,
        })),
      },
    },
    select: { id: true, number: true },
  });
  await recordAudit({ actorUserId: viewer.id, entityType: "QualityInspection", entityId: created.id, action: "create", after: { number: created.number, kind: input.kind, jobId } });
  return { id: created.id, created: true };
}

function uniqueAreas(areas: { name: string; trade?: string | null }[]): { name: string; trade: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; trade: string | null }[] = [];
  for (const a of areas) {
    const name = a.name.trim().slice(0, 80);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, trade: isTradeKey(a.trade) ? a.trade : null });
  }
  return out;
}

export type UpdateInput = {
  title?: string | null;
  kind?: InspectionKind;
  jobId?: string | null;
  laborContractId?: string | null;
  addressText?: string | null;
  scopeText?: string | null;
  qualityProfile?: string;
  close?: boolean;
};

export async function updateInspection(viewer: Viewer, id: string, patch: UpdateInput): Promise<void> {
  const { insp, rights } = await scopeFor(viewer, id);
  need(rights.canEdit, "You cannot change this inspection.");
  const data: Prisma.QualityInspectionUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title?.trim() || null;
  if (patch.kind) data.kind = patch.kind as QualityInspectionKind;
  if (patch.addressText !== undefined) data.addressText = patch.addressText?.trim() || null;
  if (patch.scopeText !== undefined) data.scopeText = patch.scopeText?.trim() || null;
  if (patch.qualityProfile !== undefined) {
    if (!isQualityProfile(patch.qualityProfile)) throw new InspectorError(400, "Unknown quality bar");
    data.qualityProfile = patch.qualityProfile;
  }
  let jobId = insp.jobId;
  if (patch.jobId !== undefined && patch.jobId !== insp.jobId) {
    // attaching a Quick inspection to a job; moving one off its job is not offered
    if (insp.jobId) throw new InspectorError(400, "This inspection already belongs to a job");
    if (!patch.jobId) throw new InspectorError(400, "Choose a job");
    await checkStart(viewer, patch.jobId);
    jobId = patch.jobId;
    data.jobId = jobId;
  }
  if (patch.laborContractId !== undefined) {
    const contract = await checkContract(patch.laborContractId, jobId);
    data.laborContractId = patch.laborContractId || null;
    if (contract && patch.scopeText === undefined) {
      const current = await prisma.qualityInspection.findUnique({ where: { id }, select: { scopeText: true } });
      if (!current?.scopeText) data.scopeText = scopeFromContract(contract);
    }
  }
  if (patch.close) {
    need(rights.canReview, "Only the office or the job's project manager can close an inspection.");
    data.status = "CLOSED";
    data.closedAt = new Date();
  }
  await prisma.$transaction(async (tx) => {
    await tx.qualityInspection.update({ where: { id }, data });
    // the photos join the job's files once the inspection has a job
    if (data.jobId) {
      const job = await tx.job.findUniqueOrThrow({ where: { id: jobId! }, select: { leadId: true } });
      await tx.file.updateMany({ where: { qualityInspectionId: id }, data: { jobId, leadId: job.leadId } });
    }
  });
  await recordAudit({ actorUserId: viewer.id, entityType: "QualityInspection", entityId: id, action: patch.close ? "close" : "update", after: { ...patch } });
}

export async function addArea(viewer: Viewer, inspectionId: string, input: { id?: string; name: string; trade?: string | null }): Promise<{ id: string }> {
  const { insp, rights } = await scopeFor(viewer, inspectionId);
  need(rights.canAddPhotos || rights.canEdit, "You cannot change this inspection.");
  const [a] = uniqueAreas([input]);
  if (!a) throw new InspectorError(400, "Name the area");
  // a phone resending an area it already made (its own id)
  if (input.id) {
    if (!CLIENT_ID_RE.test(input.id)) throw new InspectorError(400, "Bad id");
    const mine = await prisma.qualityInspectionArea.findUnique({ where: { id: input.id }, select: { id: true, inspectionId: true } });
    if (mine) {
      if (mine.inspectionId !== inspectionId) throw new InspectorError(409, "That id is already used", "id_taken");
      return { id: mine.id };
    }
  }
  const existing = await prisma.qualityInspectionArea.findFirst({ where: { inspectionId, name: { equals: a.name, mode: "insensitive" } }, select: { id: true } });
  if (existing) return existing;
  const jobArea = insp.jobId ? await prisma.jobArea.findFirst({ where: { jobId: insp.jobId, isActive: true, name: { equals: a.name, mode: "insensitive" } }, select: { id: true } }) : null;
  const count = await prisma.qualityInspectionArea.count({ where: { inspectionId } });
  return prisma.qualityInspectionArea.create({ data: { ...(input.id ? { id: input.id } : {}), inspectionId, name: a.name, trade: a.trade, sortOrder: count, jobAreaId: jobArea?.id ?? null }, select: { id: true } });
}

/** Rename, set the trade, or — for a reviewer — mark the area checked by a person ("looks_complete"). */
export async function updateArea(viewer: Viewer, areaId: string, input: { name?: string; trade?: string | null; checked?: boolean }): Promise<void> {
  const area = await prisma.qualityInspectionArea.findUnique({ where: { id: areaId }, select: { inspectionId: true } });
  if (!area) throw new InspectorError(404, "Area not found");
  const { rights } = await scopeFor(viewer, area.inspectionId);
  need(rights.canAddPhotos || rights.canEdit, "You cannot change this inspection.");
  const data: Prisma.QualityInspectionAreaUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new InspectorError(400, "Name the area");
    data.name = name;
  }
  if (input.trade !== undefined) data.trade = isTradeKey(input.trade) ? input.trade : null;
  if (input.checked) {
    need(rights.canReview, "Only the office or the job's project manager can mark an area checked.");
    data.verdict = "looks_complete";
    data.photosNeeded = [];
  }
  await prisma.qualityInspectionArea.update({ where: { id: areaId }, data });
  if (input.checked) await recordAudit({ actorUserId: viewer.id, entityType: "QualityInspectionArea", entityId: areaId, action: "checked_by_person" });
}

// ── Findings ──────────────────────────────────────────────────────────────

export type ReviewInput = {
  op: "confirm" | "dismiss" | "reopen" | "resolve" | "unresolve" | "edit";
  title?: string;
  evidence?: string;
  action?: string | null;
  severity?: Severity;
  boxes?: Box[];
  dismissReason?: string;
  note?: string | null;
};

async function findingScope(viewer: Viewer, findingId: string) {
  const f = await prisma.qualityInspectionFinding.findUnique({
    where: { id: findingId },
    select: { id: true, inspectionId: true, review: true, title: true, evidence: true, action: true, severity: true, boxes: true, resolvedAt: true, photo: { select: { width: true, height: true } }, fieldIssue: { select: { id: true, taskId: true, status: true } } },
  });
  if (!f) throw new InspectorError(404, "Finding not found");
  const { insp, rights } = await scopeFor(viewer, f.inspectionId);
  need(rights.canReview, "Only the office or the job's project manager can review findings.");
  return { f, insp, rights };
}

export async function reviewFinding(viewer: Viewer, findingId: string, input: ReviewInput): Promise<void> {
  const { f } = await findingScope(viewer, findingId);
  const now = new Date();
  const data: Prisma.QualityInspectionFindingUncheckedUpdateInput = {};
  let edited = false;
  if (input.title !== undefined && input.title.trim() && input.title.trim() !== f.title) {
    data.title = input.title.trim().slice(0, 200);
    edited = true;
  }
  if (input.evidence !== undefined && input.evidence.trim() !== f.evidence) {
    data.evidence = input.evidence.trim().slice(0, 4000);
    edited = true;
  }
  if (input.action !== undefined && (input.action?.trim() || null) !== f.action) {
    data.action = input.action?.trim().slice(0, 2000) || null;
    edited = true;
  }
  if (input.severity && input.severity !== f.severity) {
    data.severity = input.severity as QualitySeverity;
    edited = true;
  }
  if (input.boxes) {
    if (!f.photo) throw new InspectorError(400, "This finding is not on a photo");
    const boxes = input.boxes.map((b) => cleanBox(b, f.photo!)).filter((b): b is Box => !!b).slice(0, 6);
    data.boxes = boxes;
    edited = true;
  }
  if (input.note !== undefined) data.reviewNote = input.note?.trim() || null;
  switch (input.op) {
    case "confirm":
      data.review = "CONFIRMED";
      data.dismissReason = null;
      break;
    case "dismiss":
      if (f.fieldIssue && f.fieldIssue.status !== "COMPLETED" && f.fieldIssue.status !== "CANCELLED") throw new InspectorError(409, "This finding has an open punch item; close the punch item first");
      if (!(DISMISS_REASONS as readonly string[]).includes(input.dismissReason ?? "")) throw new InspectorError(400, "Say why it is dismissed");
      data.review = "DISMISSED";
      data.dismissReason = input.dismissReason;
      break;
    case "reopen":
      if (f.fieldIssue) throw new InspectorError(409, "This finding already has a punch item");
      data.review = "PROPOSED";
      data.dismissReason = null;
      break;
    case "resolve":
      if (f.review !== "CONFIRMED") throw new InspectorError(409, "Only a confirmed finding can be marked fixed");
      data.resolvedAt = now;
      data.resolvedByUserId = viewer.id;
      break;
    case "unresolve":
      data.resolvedAt = null;
      data.resolvedByUserId = null;
      break;
    case "edit":
      break;
  }
  if (input.op === "confirm" || input.op === "dismiss" || input.op === "reopen") {
    data.reviewedByUserId = viewer.id;
    data.reviewedAt = now;
  }
  if (edited) data.edited = true;
  await prisma.qualityInspectionFinding.update({ where: { id: findingId }, data });
  // a finding marked fixed by hand closes its punch item too
  if (input.op === "resolve" && f.fieldIssue?.taskId && f.fieldIssue.status !== "COMPLETED") {
    await updateTask({ id: f.fieldIssue.taskId, input: { status: "COMPLETED" }, actorUserId: viewer.id, actorRole: viewer.role }).catch(() => undefined);
  }
  await recordAudit({ actorUserId: viewer.id, entityType: "QualityInspectionFinding", entityId: findingId, action: `finding_${input.op}`, after: { edited, severity: input.severity, dismissReason: input.dismissReason } });
}

export type AddFindingInput = {
  areaId?: string | null;
  photoId?: string | null;
  title: string;
  evidence?: string;
  action?: string | null;
  severity: Severity;
  kind?: QualityFindingKind;
  trade?: string | null;
  boxes?: Box[];
};

/** A finding a person adds (the AI missed it): confirmed as it is made. */
export async function addFinding(viewer: Viewer, inspectionId: string, input: AddFindingInput): Promise<{ id: string }> {
  const { rights } = await scopeFor(viewer, inspectionId);
  need(rights.canReview, "Only the office or the job's project manager can add findings.");
  const photo = input.photoId ? await prisma.qualityInspectionPhoto.findFirst({ where: { id: input.photoId, inspectionId }, select: { id: true, areaId: true, width: true, height: true } }) : null;
  if (input.photoId && !photo) throw new InspectorError(404, "Photo not found");
  const areaId = input.areaId ?? photo?.areaId ?? null;
  if (areaId && !(await prisma.qualityInspectionArea.findFirst({ where: { id: areaId, inspectionId }, select: { id: true } }))) throw new InspectorError(404, "Area not found");
  const boxes = photo ? (input.boxes ?? []).map((b) => cleanBox(b, photo)).filter((b): b is Box => !!b).slice(0, 6) : [];
  const row = await prisma.qualityInspectionFinding.create({
    data: {
      inspectionId,
      areaId,
      photoId: photo?.id ?? null,
      source: "PERSON",
      kind: input.kind ?? "OBSERVED",
      trade: isTradeKey(input.trade) ? input.trade : "general",
      title: input.title.trim().slice(0, 200),
      evidence: (input.evidence ?? "").trim().slice(0, 4000),
      action: input.action?.trim() || null,
      severity: input.severity as QualitySeverity,
      boxes,
      review: "CONFIRMED",
      reviewedByUserId: viewer.id,
      reviewedAt: new Date(),
    },
    select: { id: true },
  });
  await recordAudit({ actorUserId: viewer.id, entityType: "QualityInspectionFinding", entityId: row.id, action: "finding_add" });
  return row;
}

/**
 * Confirmed findings without a punch item become ordinary punch items
 * (FieldIssue PUNCH → task), one each. Needs a job. `findingIds` narrows it.
 */
export async function raisePunchItems(viewer: Viewer, inspectionId: string, findingIds?: string[]): Promise<{ created: number; skipped: number }> {
  const { insp, rights } = await scopeFor(viewer, inspectionId);
  need(rights.canReview, "Only the office or the job's project manager can raise punch items.");
  if (!insp.jobId) throw new InspectorError(400, "Attach the inspection to a job before raising punch items");
  const meta = await prisma.qualityInspection.findUniqueOrThrow({ where: { id: inspectionId }, select: { number: true, job: { select: { projectManagerId: true } } } });
  const findings = await prisma.qualityInspectionFinding.findMany({
    where: { inspectionId, review: "CONFIRMED", resolvedAt: null, fieldIssue: null, ...(findingIds?.length ? { id: { in: findingIds } } : {}) },
    select: { id: true, title: true, evidence: true, action: true, physicalCheck: true, severity: true, area: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  let created = 0;
  let skipped = 0;
  for (const f of findings) {
    const description = [
      f.evidence,
      f.action ? `Fix: ${f.action}` : null,
      f.physicalCheck ? `Check: ${f.physicalCheck}` : null,
      `From inspection ${meta.number}: ${env.APP_BASE_URL}/field-inspections/${inspectionId}#f-${f.id}`,
    ].filter(Boolean).join("\n\n");
    try {
      await createFieldIssue(
        {
          jobId: insp.jobId,
          type: "PUNCH",
          title: `${f.area?.name ? `${f.area.name}: ` : ""}${f.title}`.slice(0, 200),
          description,
          priority: priorityFor(f.severity as Severity),
          assignedUserId: meta.job?.projectManagerId ?? null,
          qualityFindingId: f.id,
        },
        viewer,
        { projectManagerId: meta.job?.projectManagerId ?? null },
      );
      created++;
    } catch (err) {
      // a second click racing the first: the unique link refuses the duplicate
      if ((err as { code?: string }).code === "P2002") skipped++;
      else throw err;
    }
  }
  return { created, skipped };
}

// ── Accept ────────────────────────────────────────────────────────────────

async function factsFor(inspectionId: string): Promise<InspectionFacts> {
  const i = await prisma.qualityInspection.findUniqueOrThrow({
    where: { id: inspectionId },
    select: {
      status: true,
      _count: { select: { photos: true } },
      areas: { select: { verdict: true } },
      analyses: { where: { status: { in: ["QUEUED", "RUNNING", "FAILED"] } }, select: { status: true } },
      findings: { select: { review: true, severity: true, resolvedAt: true, fieldIssue: { select: { status: true } } } },
    },
  });
  return factsOf(i);
}

function factsOf(i: {
  status: "OPEN" | "ACCEPTED" | "CLOSED";
  _count: { photos: number };
  areas: { verdict: string | null }[];
  analyses: { status: string }[];
  findings: { review: "PROPOSED" | "CONFIRMED" | "DISMISSED"; severity: QualitySeverity; resolvedAt: Date | null; fieldIssue: { status: string } | null }[];
}): InspectionFacts {
  return {
    status: i.status,
    photos: i._count.photos,
    pendingAnalyses: i.analyses.filter((a) => a.status === "QUEUED" || a.status === "RUNNING").length,
    failedAnalyses: i.analyses.filter((a) => a.status === "FAILED").length,
    areaVerdicts: i.areas.map((a) => (a.verdict as Verdict | null) ?? null),
    findings: i.findings.map((f) => ({ review: f.review, severity: f.severity as Severity, resolvedAt: f.resolvedAt, punchDone: f.fieldIssue?.status === "COMPLETED" })),
  };
}

export async function acceptInspection(viewer: Viewer, id: string, override?: string | null): Promise<void> {
  const { rights } = await scopeFor(viewer, id);
  need(rights.canReview, "Only the office or the job's project manager can accept an inspection.");
  const check = acceptBlockers(await factsFor(id));
  if (check.hard.length) throw new InspectorError(409, check.hard.join(" "), "blocked");
  const reason = override?.trim() || null;
  if (check.overridable.length) {
    if (!rights.canOverride) throw new InspectorError(409, `${check.overridable.join(" ")} An admin or manager can accept with a reason.`, "needs_override");
    if (!reason) throw new InspectorError(400, "Give the reason for accepting with open items", "needs_reason");
  }
  const done = await prisma.qualityInspection.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: viewer.id, acceptOverride: check.overridable.length ? reason : null },
  });
  if (!done.count) throw new InspectorError(409, "Someone else has just changed this inspection");
  await recordAudit({ actorUserId: viewer.id, entityType: "QualityInspection", entityId: id, action: check.overridable.length ? "accept_override" : "accept", after: { open: check.overridable, reason } });
}

// ── Reading ───────────────────────────────────────────────────────────────

const name = (u: { firstName: string | null; lastName: string | null } | null) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);

export async function readInspection(viewer: Viewer, id: string) {
  const { rights } = await scopeFor(viewer, id);
  const i = await prisma.qualityInspection.findUniqueOrThrow({
    where: { id },
    include: {
      job: { select: { ...JOB_LABEL_SELECT, projectManagerId: true } },
      laborContract: { select: { id: true, label: true, crew: { select: { name: true } } } },
      startedBy: { select: { firstName: true, lastName: true } },
      acceptedBy: { select: { firstName: true, lastName: true } },
      areas: { orderBy: { sortOrder: "asc" } },
      photos: { orderBy: { createdAt: "asc" }, include: { file: { select: { fileName: true, takenAt: true, createdAt: true } }, analysis: { select: { status: true } } } },
      analyses: { orderBy: { createdAt: "asc" }, select: { id: true, areaId: true, status: true, mode: true, error: true, costUsd: true, model: true, durationMs: true, finishedAt: true } },
      findings: { orderBy: { createdAt: "asc" }, include: { reviewedBy: { select: { firstName: true, lastName: true } }, fieldIssue: { select: { id: true, status: true, taskId: true } } } },
    },
  });
  const facts = factsOf({ ...i, _count: { photos: i.photos.length } });
  const findings = i.findings
    .filter((f) => rights.canSeeProposed || f.review === "CONFIRMED")
    .map((f) => ({
      id: f.id,
      areaId: f.areaId,
      photoId: f.photoId,
      relatedPhotoIds: Array.isArray(f.relatedPhotoIds) ? (f.relatedPhotoIds as string[]) : [],
      source: f.source,
      kind: f.kind,
      trade: f.trade,
      tradeLabel: tradeLabel(f.trade),
      title: f.title,
      evidence: f.evidence,
      severity: f.severity,
      confidence: rights.canSeeProposed ? f.confidence : null,
      action: f.action,
      physicalCheck: f.physicalCheck,
      boxes: parseBoxes(f.boxes),
      review: f.review,
      edited: f.edited,
      dismissReason: f.dismissReason,
      reviewNote: f.reviewNote,
      reviewedBy: name(f.reviewedBy),
      reviewedAt: f.reviewedAt,
      resolved: findingResolved({ resolvedAt: f.resolvedAt, punchDone: f.fieldIssue?.status === "COMPLETED" }),
      punch: f.fieldIssue ? { id: f.fieldIssue.id, status: f.fieldIssue.status, taskId: f.fieldIssue.taskId } : null,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity as Severity] - SEVERITY_ORDER[b.severity as Severity]);
  const pendingIds = new Set(i.analyses.filter((a) => a.status === "QUEUED" || a.status === "RUNNING").map((a) => a.id));
  const phase = phaseOf(facts);
  const blockers = i.status === "OPEN" ? acceptBlockers(facts) : { hard: [], overridable: [] };
  const label = i.job ? jobLabel(i.job) : null;
  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    kindLabel: KIND_LABEL[i.kind as InspectionKind],
    status: i.status,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    title: i.title,
    job: i.job && label ? { id: i.job.id, label: label.primary, secondary: label.secondary, code: label.code } : null,
    laborContract: i.laborContract ? { id: i.laborContract.id, name: contractorName(i.laborContract) } : null,
    addressText: i.addressText,
    scopeText: i.scopeText,
    qualityProfile: i.qualityProfile,
    startedBy: name(i.startedBy),
    createdAt: i.createdAt,
    acceptedAt: i.acceptedAt,
    acceptedBy: name(i.acceptedBy),
    acceptOverride: i.acceptOverride,
    areas: i.areas.map((a) => ({
      id: a.id,
      name: a.name,
      trade: a.trade,
      tradeLabel: a.trade ? tradeLabel(a.trade) : null,
      verdict: rights.canSeeProposed ? a.verdict : null,
      summary: rights.canSeeProposed ? a.summary : null,
      photosNeeded: Array.isArray(a.photosNeeded) ? (a.photosNeeded as string[]) : [],
      photoCount: i.photos.filter((p) => p.areaId === a.id).length,
      openFindings: findings.filter((f) => f.areaId === a.id && f.review !== "DISMISSED" && !f.resolved).length,
    })),
    photos: i.photos.map((p) => ({
      id: p.id,
      fileId: p.fileId,
      url: `/api/files/${p.fileId}`,
      areaId: p.areaId,
      role: p.role,
      width: p.width,
      height: p.height,
      quality: p.quality,
      takenAt: p.file.takenAt ?? p.file.createdAt,
      state: !p.analysisId ? "waiting" : pendingIds.has(p.analysisId) ? "analysing" : p.analysis?.status === "FAILED" ? "failed" : "done",
    })),
    failedAnalyses: i.analyses.filter((a) => a.status === "FAILED").map((a) => ({ id: a.id, areaId: a.areaId, error: a.error })),
    pendingAnalyses: pendingIds.size,
    aiCostUsd: rights.canSeeProposed ? Math.round(i.analyses.reduce((s, a) => s + (a.costUsd ?? 0), 0) * 10000) / 10000 : null,
    findings,
    blockers,
    rights,
  };
}
export type InspectionView = Awaited<ReturnType<typeof readInspection>>;

/** Inspections this viewer may see. Office and READ_ONLY: all; others: theirs and their jobs'. */
export function listWhere(viewer: Viewer): Prisma.QualityInspectionWhereInput {
  if (isOffice(viewer.role) || viewer.role === "READ_ONLY") return {};
  return { OR: [{ startedByUserId: viewer.id }, { job: { projectManagerId: viewer.id } }, { job: jobsInvolvingUserWhere(viewer.id) }] };
}

export async function listInspections(viewer: Viewer, q: { jobId?: string | null; status?: "OPEN" | "ACCEPTED" | "CLOSED" | null; mine?: boolean; take?: number }) {
  const rows = await prisma.qualityInspection.findMany({
    where: { AND: [listWhere(viewer), q.jobId ? { jobId: q.jobId } : {}, q.status ? { status: q.status } : {}, q.mine ? { startedByUserId: viewer.id } : {}] },
    orderBy: { createdAt: "desc" },
    take: Math.min(q.take ?? 100, 200),
    select: {
      id: true,
      number: true,
      kind: true,
      status: true,
      title: true,
      addressText: true,
      createdAt: true,
      acceptedAt: true,
      job: { select: JOB_LABEL_SELECT },
      startedBy: { select: { firstName: true, lastName: true } },
      laborContract: { select: { label: true, crew: { select: { name: true } } } },
      _count: { select: { photos: true } },
      areas: { select: { verdict: true } },
      analyses: { where: { status: { in: ["QUEUED", "RUNNING", "FAILED"] } }, select: { status: true } },
      findings: { select: { review: true, severity: true, resolvedAt: true, fieldIssue: { select: { status: true } } } },
    },
  });
  const crew = viewer.role === "CREW_LEAD" || viewer.role === "CREW_MEMBER";
  return rows.map((r) => {
    const facts = factsOf(r);
    const phase = phaseOf(facts);
    const label = r.job ? jobLabel(r.job) : null;
    const visible = r.findings.filter((f) => !crew || f.review === "CONFIRMED");
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      kindLabel: KIND_LABEL[r.kind as InspectionKind],
      status: r.status,
      phase,
      phaseLabel: PHASE_LABEL[phase],
      title: r.title,
      place: label?.primary ?? r.addressText ?? "No address",
      job: r.job && label ? { id: r.job.id, code: label.code } : null,
      contractor: r.laborContract ? contractorName(r.laborContract) : null,
      startedBy: name(r.startedBy),
      createdAt: r.createdAt,
      acceptedAt: r.acceptedAt,
      photos: r._count.photos,
      toReview: crew ? 0 : r.findings.filter((f) => f.review === "PROPOSED").length,
      open: visible.filter((f) => f.review === "CONFIRMED" && !f.resolvedAt && f.fieldIssue?.status !== "COMPLETED").length,
    };
  });
}

/** What the set-up sheet offers: the catalog, and for a job its rooms and contractors (names only, never amounts). */
export async function startOptions(viewer: Viewer, jobId: string | null) {
  const job = await checkStart(viewer, jobId);
  const [areas, contracts] = jobId
    ? await Promise.all([
        prisma.jobArea.findMany({ where: { jobId, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
        prisma.laborContract.findMany({ where: { jobId }, orderBy: { createdAt: "desc" }, select: { id: true, label: true, crew: { select: { name: true } }, _count: { select: { tasks: true } } } }),
      ])
    : [[], []];
  return {
    kinds: INSPECTION_KINDS.map((k) => ({ key: k, label: KIND_LABEL[k] })),
    profiles: QUALITY_PROFILES.map((p) => ({ key: p, label: PROFILE_LABEL[p] })),
    trades: TRADES.map((t) => ({ key: t.key, label: t.label })),
    defaultProfile: defaultProfile(job),
    areas,
    contracts: contracts.map((c) => ({ id: c.id, name: contractorName(c), lines: c._count.tasks })),
  };
}
