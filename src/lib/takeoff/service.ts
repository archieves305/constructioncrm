/**
 * Plan sets: the database side. Reading a page is in `sheets/*` (pure) and
 * the worker; this file writes rows, files and audit lines and decides
 * nothing about drawings.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { deleteFile, deleteStorageDir, fileExists, saveFile } from "@/lib/files/storage";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { createIndexJob } from "./pipeline/runner";
import { describeProgress, type StepState } from "./pipeline/plan";
import { documentArtifactKey } from "./sheet-cache";
import { parseScaleText } from "./sheets/scale";
import type { DetectedIndex } from "./types";
import type { PatchSheetInput } from "./validation";

const SHEET_SELECT = {
  id: true,
  planDocumentId: true,
  pageNumber: true,
  widthPt: true,
  heightPt: true,
  rotation: true,
  sheetNumber: true,
  title: true,
  discipline: true,
  revisionLabel: true,
  scaleText: true,
  detected: true,
  indexConfidence: true,
  indexCorrectedByUserId: true,
  isRaster: true,
  textItemCount: true,
  segmentCount: true,
  textKey: true,
  renderKey72: true,
  renderKey144: true,
  scaleSource: true,
  ptPerFt: true,
  scaleConfidence: true,
  scaleVerification: true,
  supersededBySheetId: true,
  updatedAt: true,
} satisfies Prisma.PlanSheetSelect;

type SheetRow = Prisma.PlanSheetGetPayload<{ select: typeof SHEET_SELECT }>;

/** A sheet as the screens see it: no storage keys. */
export function presentSheet(s: SheetRow) {
  const { textKey, renderKey72, renderKey144, indexCorrectedByUserId, detected, ...rest } = s;
  return {
    ...rest,
    detected: detected as DetectedIndex | null,
    corrected: !!indexCorrectedByUserId,
    hasText: !!textKey,
    rendered: !!renderKey72,
    rendered144: !!renderKey144,
  };
}

export type PresentedSheet = ReturnType<typeof presentSheet>;

const JOB_SELECT = {
  id: true,
  kind: true,
  status: true,
  totalSteps: true,
  doneSteps: true,
  failedSteps: true,
  error: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  updatedAt: true,
  steps: { select: { stepKey: true, status: true, dependsOn: true, error: true } },
} satisfies Prisma.PlanJobSelect;

type JobRow = Prisma.PlanJobGetPayload<{ select: typeof JOB_SELECT }>;

export function presentJob(j: JobRow) {
  const { steps, ...rest } = j;
  return {
    ...rest,
    progress: describeProgress(steps as StepState[]),
    failed: steps.filter((s) => s.status === "FAILED").map((s) => ({ stepKey: s.stepKey, error: s.error })),
  };
}

export type PresentedJob = ReturnType<typeof presentJob>;

const DOCUMENT_INCLUDE = {
  file: { select: { id: true, fileName: true, fileSize: true, storageKey: true } },
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
  jobs: { select: JOB_SELECT, orderBy: { createdAt: "desc" as const }, take: 1 },
  _count: { select: { sheets: true } },
} satisfies Prisma.PlanDocumentInclude;

type DocumentRow = Prisma.PlanDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

async function presentDocument(d: DocumentRow) {
  const { file, jobs, _count, ...rest } = d;
  return {
    ...rest,
    file: { id: file.id, fileName: file.fileName, fileSize: file.fileSize, missing: !(await fileExists(file.storageKey)) },
    sheetCount: _count.sheets,
    job: jobs[0] ? presentJob(jobs[0]) : null,
  };
}

export type PresentedDocument = Awaited<ReturnType<typeof presentDocument>>;

const PLAN_SET_INCLUDE = {
  job: { select: JOB_LABEL_SELECT },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  documents: { include: DOCUMENT_INCLUDE, orderBy: { sequence: "asc" as const } },
} satisfies Prisma.PlanSetInclude;

type PlanSetRow = Prisma.PlanSetGetPayload<{ include: typeof PLAN_SET_INCLUDE }>;

async function presentPlanSet(p: PlanSetRow) {
  const { documents, ...rest } = p;
  return { ...rest, documents: await Promise.all(documents.map(presentDocument)) };
}

export type PresentedPlanSet = Awaited<ReturnType<typeof presentPlanSet>>;

export async function listPlanSets(leadId: string) {
  const rows = await prisma.planSet.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, include: PLAN_SET_INCLUDE });
  return Promise.all(rows.map(presentPlanSet));
}

export async function getPlanSet(id: string) {
  const row = await prisma.planSet.findUnique({ where: { id }, include: PLAN_SET_INCLUDE });
  return row ? presentPlanSet(row) : null;
}

export async function planSetLead(id: string): Promise<{ leadId: string } | null> {
  return prisma.planSet.findUnique({ where: { id }, select: { leadId: true } });
}

export async function sheetLead(sheetId: string): Promise<{ leadId: string; planSetId: string } | null> {
  const s = await prisma.planSheet.findUnique({ where: { id: sheetId }, select: { planDocument: { select: { planSet: { select: { id: true, leadId: true } } } } } });
  return s ? { leadId: s.planDocument.planSet.leadId, planSetId: s.planDocument.planSet.id } : null;
}

export async function jobLead(jobId: string): Promise<{ leadId: string } | null> {
  const j = await prisma.planJob.findUnique({ where: { id: jobId }, select: { planDocument: { select: { planSet: { select: { leadId: true } } } } } });
  return j?.planDocument ? { leadId: j.planDocument.planSet.leadId } : null;
}

/** A plan set belongs to the job when the caller says so, or when the lead has exactly one job. */
async function jobFor(leadId: string, jobId: string | null): Promise<string | null> {
  if (jobId) return jobId;
  const jobs = await prisma.job.findMany({ where: { leadId }, select: { id: true }, take: 2 });
  return jobs.length === 1 ? jobs[0].id : null;
}

export async function createPlanSet(input: { leadId: string; jobId: string | null; name: string; userId: string }) {
  const row = await prisma.planSet.create({
    data: { leadId: input.leadId, jobId: await jobFor(input.leadId, input.jobId), name: input.name, createdByUserId: input.userId },
    include: PLAN_SET_INCLUDE,
  });
  await recordAudit({ actorUserId: input.userId, entityType: "plan_set", entityId: row.id, action: "create", after: { leadId: input.leadId, name: input.name } });
  return presentPlanSet(row);
}

export async function updatePlanSet(id: string, patch: { name?: string; notes?: string | null; jobId?: string | null }, userId: string) {
  const before = await prisma.planSet.findUnique({ where: { id }, select: { name: true, notes: true, jobId: true } });
  if (!before) return null;
  const row = await prisma.planSet.update({ where: { id }, data: patch, include: PLAN_SET_INCLUDE });
  await recordAudit({ actorUserId: userId, entityType: "plan_set", entityId: id, action: "update", before, after: patch });
  return presentPlanSet(row);
}

/**
 * Remove a plan set with its documents, sheets, jobs and every derived file.
 * The uploaded PDFs go too — they were files of this set alone.
 */
export async function deletePlanSet(id: string, userId: string) {
  const row = await prisma.planSet.findUnique({ where: { id }, select: { id: true, leadId: true, name: true, documents: { select: { id: true, fileId: true, file: { select: { storageKey: true } } } } } });
  if (!row) return null;
  await prisma.$transaction(async (tx) => {
    await tx.planSet.delete({ where: { id } });
    await tx.file.deleteMany({ where: { id: { in: row.documents.map((d) => d.fileId) } } });
  });
  for (const d of row.documents) {
    await deleteFile(d.file.storageKey);
    await deleteStorageDir(documentArtifactKey(d.id));
  }
  await recordAudit({ actorUserId: userId, entityType: "plan_set", entityId: id, action: "delete", before: { name: row.name, documents: row.documents.length } });
  return row;
}

/**
 * Add a PDF to a set: store it, record the document, and start the job that
 * reads its pages. The request returns as soon as the file is on disk; the
 * reading happens tick by tick.
 */
export async function addDocument(input: { planSetId: string; buffer: Buffer; fileName: string; kind: "FULL_SET" | "PARTIAL" | "ADDENDUM" | "REVISION"; label: string; revisionLabel: string | null; userId: string }) {
  const set = await prisma.planSet.findUnique({ where: { id: input.planSetId }, select: { id: true, leadId: true, jobId: true, documents: { select: { sha256: true, sequence: true, label: true } } } });
  if (!set) return { error: "not_found" as const };
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const dup = set.documents.find((d) => d.sha256 === sha256);
  if (dup) return { error: "duplicate" as const, label: dup.label };
  const stored = await saveFile(input.buffer, input.fileName);
  const sequence = set.documents.reduce((m, d) => Math.max(m, d.sequence), 0) + 1;
  const { document, job } = await prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: { leadId: set.leadId, jobId: set.jobId, fileName: input.fileName, fileType: "application/pdf", fileSize: stored.bytes, storageKey: stored.storageKey, category: "PLAN_SET", uploadedByUserId: input.userId },
      select: { id: true },
    });
    const document = await tx.planDocument.create({
      data: { planSetId: set.id, fileId: file.id, kind: input.kind, label: input.label, revisionLabel: input.revisionLabel, sequence, sha256, uploadedByUserId: input.userId },
      select: { id: true },
    });
    const job = await createIndexJob(tx, document.id, input.userId);
    return { document, job };
  });
  await recordAudit({ actorUserId: input.userId, entityType: "plan_document", entityId: document.id, action: "create", after: { planSetId: set.id, fileName: input.fileName, bytes: stored.bytes, kind: input.kind, label: input.label } });
  const row = await prisma.planDocument.findUniqueOrThrow({ where: { id: document.id }, include: DOCUMENT_INCLUDE });
  return { document: await presentDocument(row), jobId: job.id };
}

export async function listSheets(planSetId: string) {
  const rows = await prisma.planSheet.findMany({
    where: { planDocument: { planSetId } },
    orderBy: [{ planDocument: { sequence: "asc" } }, { pageNumber: "asc" }],
    select: SHEET_SELECT,
  });
  return rows.map(presentSheet);
}

export async function getSheet(id: string) {
  const row = await prisma.planSheet.findUnique({ where: { id }, select: SHEET_SELECT });
  return row ? presentSheet(row) : null;
}

/**
 * A person's correction of the index. The corrected fields are what is in
 * force from now on; `detected` keeps what code read. A new scale text
 * re-derives the AUTO calibration unless the sheet was calibrated by hand.
 */
export async function updateSheet(id: string, patch: PatchSheetInput, userId: string) {
  const current = await prisma.planSheet.findUnique({ where: { id }, select: { ...SHEET_SELECT, planDocument: { select: { planSetId: true } } } });
  if (!current) return null;
  if (patch.supersededBySheetId) {
    const other = await prisma.planSheet.findFirst({ where: { id: patch.supersededBySheetId, planDocument: { planSetId: current.planDocument.planSetId } }, select: { id: true } });
    if (!other || other.id === id) return { error: "That sheet is not in this plan set" as const };
  }
  const data: Prisma.PlanSheetUpdateInput = {};
  if (patch.sheetNumber !== undefined) data.sheetNumber = patch.sheetNumber ? patch.sheetNumber.toUpperCase() : null;
  if (patch.title !== undefined) data.title = patch.title || null;
  if (patch.discipline !== undefined) data.discipline = patch.discipline as Prisma.PlanSheetUpdateInput["discipline"];
  if (patch.revisionLabel !== undefined) data.revisionLabel = patch.revisionLabel || null;
  if (patch.supersededBySheetId !== undefined) data.supersededBy = patch.supersededBySheetId ? { connect: { id: patch.supersededBySheetId } } : { disconnect: true };
  if (patch.scaleText !== undefined) {
    data.scaleText = patch.scaleText || null;
    if (current.scaleSource === "NONE" || current.scaleSource === "AUTO") {
      const parsed = patch.scaleText ? parseScaleText(patch.scaleText) : null;
      const ptPerFt = parsed && !parsed.nts ? parsed.ptPerFt : null;
      data.scaleSource = ptPerFt ? "AUTO" : "NONE";
      data.ptPerFt = ptPerFt;
      data.scaleConfidence = ptPerFt ? 0.6 : null;
    }
  }
  data.correctedBy = { connect: { id: userId } };
  const row = await prisma.planSheet.update({ where: { id }, data, select: SHEET_SELECT });
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof PatchSheetInput)[]) before[k] = current[k as keyof typeof current];
  await recordAudit({ actorUserId: userId, entityType: "plan_sheet", entityId: id, action: "update", before, after: patch });
  return presentSheet(row);
}

export async function getJob(id: string) {
  const row = await prisma.planJob.findUnique({ where: { id }, select: JOB_SELECT });
  return row ? presentJob(row) : null;
}
