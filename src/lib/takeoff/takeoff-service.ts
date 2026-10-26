/**
 * Takeoffs, their sheets and measurements, and sheet calibration: the
 * database side. Numbers are computed by `measurement-value.ts` and the
 * geometry modules; nothing here decides a quantity.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { isAiConfigured } from "@/lib/ai/client";
import type { RoofAssemblyType, RoofSpecsOutput } from "./ai/schemas";
import type { Pt } from "./geometry";
import { calibrationFrom, manualCalibration, verifyScale, type Verification } from "./geometry/calibrate";
import { computeValue } from "./measurement-value";
import { metricFor, type TradeName } from "./metrics";
import { describeAnalyzeProgress, sheetOfRegionStep } from "./pipeline/analyze-plan";
import type { StepState } from "./pipeline/plan";
import type { AiMeasurementInput } from "./roofing/analyze";
import { takeoffToMeasurement, type TakeoffRowInput } from "./roofing/to-measurement";
import { createFromPlans } from "@/lib/roofing/service";
import { readSheetGeometry, readSheetText } from "./sheet-cache";
import { presentSheet } from "./service";
import { proposeSheets } from "./sheets/relevance";
import type { TakeoffSpecs } from "./specs";
import type { CalibrateInput, CreateMeasurementInput, PatchMeasurementInput } from "./validation";

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

const MEASUREMENT_INCLUDE = {
  planSheet: { select: { id: true, sheetNumber: true, title: true, pageNumber: true } },
  createdBy: PERSON,
  reviewedBy: PERSON,
} satisfies Prisma.TakeoffMeasurementInclude;

type MeasurementRow = Prisma.TakeoffMeasurementGetPayload<{ include: typeof MEASUREMENT_INCLUDE }>;

export function presentMeasurement(m: MeasurementRow) {
  return { ...m, geometry: m.geometry as { points: Pt[] }, attributes: (m.attributes ?? null) as Record<string, string | number | boolean | null> | null, evidence: (m.evidence ?? null) as Record<string, unknown> | null };
}
export type PresentedMeasurement = ReturnType<typeof presentMeasurement>;

const TAKEOFF_INCLUDE = {
  job: { select: JOB_LABEL_SELECT },
  planSet: { select: { id: true, name: true, documents: { select: { id: true } } } },
  createdBy: PERSON,
  sheets: { select: { planSheetId: true, selectedBy: true, role: true } },
  jobs: { select: { id: true, status: true, error: true, createdAt: true, finishedAt: true, steps: { select: { stepKey: true, status: true, dependsOn: true } } }, orderBy: { createdAt: "desc" as const }, take: 1 },
  _count: { select: { measurements: true } },
} satisfies Prisma.TakeoffInclude;

type TakeoffRow = Prisma.TakeoffGetPayload<{ include: typeof TAKEOFF_INCLUDE }>;

async function presentTakeoff(t: TakeoffRow) {
  const { planSet, _count, jobs, ...rest } = t;
  const pinned = (t.pinnedDocumentIds as string[]) ?? [];
  const [counts, spent, regionSteps] = await Promise.all([
    prisma.takeoffMeasurement.groupBy({ by: ["reviewStatus"], where: { takeoffId: t.id }, _count: { _all: true } }),
    prisma.aiCall.aggregate({ where: { subjectType: "takeoff", subjectId: t.id }, _sum: { costUsd: true }, _count: { _all: true } }),
    // a regions step that finished without skipping is a roof plan the model has labelled
    prisma.planJobStep.findMany({ where: { job: { takeoffId: t.id }, stepKey: { startsWith: "regions." }, status: "DONE" }, select: { stepKey: true, result: true } }),
  ]);
  const readSheets = [...new Set(regionSteps.filter((s) => !(s.result && typeof s.result === "object" && "skipped" in s.result)).map((s) => sheetOfRegionStep(s.stepKey)).filter((id): id is string => !!id))];
  const job = jobs[0] ?? null;
  return {
    ...rest,
    specs: (t.specs ?? null) as TakeoffSpecs | null,
    pinnedDocumentIds: pinned,
    planSet: { id: planSet.id, name: planSet.name },
    stale: planSet.documents.some((d) => !pinned.includes(d.id)),
    measurementCount: _count.measurements,
    byStatus: Object.fromEntries(counts.map((c) => [c.reviewStatus, c._count._all])) as Record<string, number>,
    // the analysis: whether the server can run one, the latest job and what it has cost so far
    analysis: {
      available: isAiConfigured(),
      job: job ? { id: job.id, status: job.status, error: job.error, progress: describeAnalyzeProgress(job.steps as StepState[]), createdAt: job.createdAt, finishedAt: job.finishedAt } : null,
      running: !!job && (job.status === "PENDING" || job.status === "RUNNING"),
      calls: spent._count._all,
      // roof plans the model has already labelled: a re-run on an unchanged sheet reuses that answer
      sheetsRead: readSheets,
      spentUsd: Math.round((spent._sum.costUsd ?? 0) * 100) / 100,
    },
  };
}
export type PresentedTakeoff = Awaited<ReturnType<typeof presentTakeoff>>;

export async function listTakeoffs(leadId: string) {
  const rows = await prisma.takeoff.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, include: TAKEOFF_INCLUDE });
  return Promise.all(rows.map(presentTakeoff));
}

export async function getTakeoff(id: string) {
  const row = await prisma.takeoff.findUnique({ where: { id }, include: TAKEOFF_INCLUDE });
  return row ? presentTakeoff(row) : null;
}

export async function takeoffLead(id: string): Promise<{ leadId: string } | null> {
  return prisma.takeoff.findUnique({ where: { id }, select: { leadId: true } });
}

export async function measurementLead(id: string): Promise<{ leadId: string; takeoffId: string } | null> {
  const m = await prisma.takeoffMeasurement.findUnique({ where: { id }, select: { takeoffId: true, takeoff: { select: { leadId: true } } } });
  return m ? { leadId: m.takeoff.leadId, takeoffId: m.takeoffId } : null;
}

/** "TK-0007": the next number from the sequence, never reused. */
async function nextTakeoffNumber(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('takeoff_number_seq') AS n`;
  return `TK-${String(rows[0].n).padStart(4, "0")}`;
}

/** Start a trade's takeoff on a plan set, with the sheets code proposes for that trade. */
export async function createTakeoff(input: { planSetId: string; trade: TradeName; userId: string }) {
  const set = await prisma.planSet.findUnique({
    where: { id: input.planSetId },
    select: { id: true, leadId: true, jobId: true, documents: { select: { id: true, sheets: { select: { id: true, sheetNumber: true, title: true, discipline: true } } } } },
  });
  if (!set) return null;
  const sheets = set.documents.flatMap((d) => d.sheets);
  const proposed = proposeSheets(input.trade, sheets);
  const row = await prisma.$transaction(async (tx) => {
    const number = await nextTakeoffNumber(tx);
    return tx.takeoff.create({
      data: {
        number,
        leadId: set.leadId,
        jobId: set.jobId,
        planSetId: set.id,
        trade: input.trade,
        pinnedDocumentIds: set.documents.map((d) => d.id),
        createdByUserId: input.userId,
        sheets: { create: proposed.map((p) => ({ planSheetId: p.id, selectedBy: "auto", role: p.role })) },
      },
      include: TAKEOFF_INCLUDE,
    });
  });
  await recordAudit({ actorUserId: input.userId, entityType: "takeoff", entityId: row.id, action: "create", after: { number: row.number, trade: input.trade, planSetId: set.id, sheets: proposed.length } });
  return presentTakeoff(row);
}

/** Remove a takeoff with its measurements. The plan set and its sheets stay. */
export async function deleteTakeoff(id: string, userId: string) {
  const row = await prisma.takeoff.findUnique({ where: { id }, select: { id: true, number: true, trade: true, _count: { select: { measurements: true } } } });
  if (!row) return null;
  await prisma.takeoff.delete({ where: { id } });
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: id, action: "delete", before: { number: row.number, trade: row.trade, measurements: row._count.measurements } });
  return row;
}

export async function updateTakeoff(id: string, patch: { status?: "DRAFT" | "IN_REVIEW" | "READY"; settings?: Record<string, unknown>; roofingAssembly?: { type: RoofAssemblyType; description?: string | null } | null }, userId: string) {
  const before = await prisma.takeoff.findUnique({ where: { id }, select: { status: true, settings: true, specs: true, specsReviewStatus: true } });
  if (!before) return null;
  const data: Prisma.TakeoffUpdateInput = { status: patch.status, settings: patch.settings as Prisma.InputJsonValue | undefined };
  if (patch.roofingAssembly !== undefined) {
    // a person's choice beside the plans' reading; never over it
    const who = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    const specs = ((before.specs ?? {}) as TakeoffSpecs);
    const choice = patch.roofingAssembly ? { type: patch.roofingAssembly.type, description: patch.roofingAssembly.description ?? null, byUserId: userId, byName: who ? `${who.firstName} ${who.lastName}` : "", at: new Date().toISOString() } : null;
    data.specs = { ...specs, roofing: { ...(specs.roofing ?? {}), choice } } as Prisma.InputJsonValue;
    data.specsReviewStatus = choice ? "REVIEWED" : specs.roofing?.ai ? "AI_GENERATED" : null;
  }
  const row = await prisma.takeoff.update({ where: { id }, data, include: TAKEOFF_INCLUDE });
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: id, action: "update", before: { status: before.status, settings: before.settings, specsReviewStatus: before.specsReviewStatus }, after: patch });
  return presentTakeoff(row);
}

/** The model's reading of the roof assembly, kept beside any choice a person already made. */
export async function saveRoofSpecs(takeoffId: string, ai: RoofSpecsOutput, meta: { aiCallId: string | null; promptVersion: string; sheets: string[] }) {
  const t = await prisma.takeoff.findUnique({ where: { id: takeoffId }, select: { specs: true } });
  if (!t) return null;
  const specs = (t.specs ?? {}) as TakeoffSpecs;
  const next: TakeoffSpecs = { ...specs, roofing: { ...(specs.roofing ?? {}), ai: { ...ai, aiCallId: meta.aiCallId, promptVersion: meta.promptVersion, sheets: meta.sheets, at: new Date().toISOString() } } };
  return prisma.takeoff.update({ where: { id: takeoffId }, data: { specs: next as Prisma.InputJsonValue, specsReviewStatus: specs.roofing?.choice ? "REVIEWED" : "AI_GENERATED" }, select: { id: true } });
}

/**
 * The proposals of one analysis purpose on one sheet, replacing the earlier
 * ones nobody has reviewed yet (reviewed, modified, approved and excluded
 * rows stay, and so do hand-drawn ones). Values come from `computeValue` at
 * the sheet's calibration, exactly as for a hand-drawn row; a row that
 * cannot be measured is left out and counted.
 */
export async function replaceAiMeasurements(takeoffId: string, planSheetId: string, inputs: AiMeasurementInput[], purpose: string) {
  const takeoff = await prisma.takeoff.findUnique({ where: { id: takeoffId }, select: { trade: true } });
  const sheet = await prisma.planSheet.findUnique({ where: { id: planSheetId }, select: { ptPerFt: true } });
  if (!takeoff || !sheet) throw new Error("takeoff or sheet is gone");
  const rows: Prisma.TakeoffMeasurementCreateManyInput[] = [];
  let skipped = 0;
  for (const m of inputs) {
    const metric = metricFor(takeoff.trade, m.metricKey);
    const value = metric && metric.kind === m.kind ? computeValue(m.kind, m.geometry, sheet.ptPerFt) : null;
    if (!value) { skipped++; continue; }
    rows.push({
      takeoffId,
      planSheetId,
      kind: m.kind,
      metricKey: m.metricKey,
      label: m.label.slice(0, 160),
      attributes: (m.attributes ?? undefined) as Prisma.InputJsonValue | undefined,
      geometry: m.geometry as Prisma.InputJsonValue,
      ptPerFt: m.kind === "COUNT" ? null : sheet.ptPerFt,
      valueRaw: value.valueRaw,
      unit: value.unit,
      origin: "AI",
      confidence: m.confidence,
      reviewStatus: "AI_GENERATED",
      evidence: m.evidence as Prisma.InputJsonValue,
    });
  }
  const [replaced] = await prisma.$transaction([
    prisma.takeoffMeasurement.deleteMany({ where: { takeoffId, planSheetId, origin: "AI", reviewStatus: "AI_GENERATED", evidence: { path: ["purpose"], equals: purpose } } }),
    prisma.takeoffMeasurement.createMany({ data: rows }),
  ]);
  return { created: rows.length, replaced: replaced.count, skipped };
}

/**
 * Start an analysis job on the takeoff: one at a time, roofing only until M4.
 * `planSheetIds` names the roof plans to read (else every roof plan of the
 * takeoff); a sheet of the plan set that is not one yet becomes one — the
 * person's choice, recorded as such.
 */
export async function startAnalysis(takeoffId: string, userId: string, planSheetIds?: string[]) {
  const takeoff = await prisma.takeoff.findUnique({ where: { id: takeoffId }, select: { id: true, trade: true, planSetId: true, jobs: { where: { status: { in: ["PENDING", "RUNNING"] } }, select: { id: true }, take: 1 } } });
  if (!takeoff) return null;
  if (takeoff.trade !== "ROOFING") return { error: "Plumbing analysis is not available yet" as const, status: 400 as const };
  if (takeoff.jobs.length) return { error: "An analysis is already running on this takeoff" as const, status: 409 as const };
  if (planSheetIds?.length) {
    const inSet = await prisma.planSheet.count({ where: { id: { in: planSheetIds }, planDocument: { planSetId: takeoff.planSetId } } });
    if (inSet !== new Set(planSheetIds).size) return { error: "A chosen sheet is not in this takeoff's plan set" as const, status: 400 as const };
    await prisma.$transaction(planSheetIds.map((planSheetId) => prisma.takeoffSheet.upsert({
      where: { takeoffId_planSheetId: { takeoffId, planSheetId } },
      create: { takeoffId, planSheetId, selectedBy: "user", role: "roof_plan" },
      update: {},
    })));
    // a NOT on the role alone would skip the sheets that have none
    await prisma.takeoffSheet.updateMany({ where: { takeoffId, planSheetId: { in: planSheetIds }, OR: [{ role: null }, { role: { not: "roof_plan" } }] }, data: { role: "roof_plan", selectedBy: "user" } });
  }
  const { createAnalyzeJob } = await import("./pipeline/runner");
  const job = await createAnalyzeJob(takeoffId, userId, planSheetIds);
  if (!job) return { error: "This takeoff has no roof plan selected — pick the roof plan sheets first" as const, status: 400 as const };
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: takeoffId, action: "analyze", after: { jobId: job.id, planSheetIds: planSheetIds ?? "all roof plans" } });
  return { jobId: job.id };
}

/** Replace the takeoff's sheet selection (a person's choice always says so). */
export async function setTakeoffSheets(id: string, sheets: { planSheetId: string; role?: string | null }[], userId: string) {
  const takeoff = await prisma.takeoff.findUnique({ where: { id }, select: { planSetId: true } });
  if (!takeoff) return null;
  const valid = await prisma.planSheet.findMany({ where: { id: { in: sheets.map((s) => s.planSheetId) }, planDocument: { planSetId: takeoff.planSetId } }, select: { id: true } });
  const ok = new Set(valid.map((v) => v.id));
  if (sheets.some((s) => !ok.has(s.planSheetId))) return { error: "A sheet is not in this takeoff's plan set" as const };
  await prisma.$transaction([
    prisma.takeoffSheet.deleteMany({ where: { takeoffId: id } }),
    prisma.takeoffSheet.createMany({ data: sheets.map((s) => ({ takeoffId: id, planSheetId: s.planSheetId, selectedBy: "user", role: s.role ?? null })) }),
  ]);
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: id, action: "update", after: { sheets: sheets.length } });
  return getTakeoff(id);
}

export async function listMeasurements(takeoffId: string) {
  const rows = await prisma.takeoffMeasurement.findMany({ where: { takeoffId }, orderBy: [{ planSheet: { pageNumber: "asc" } }, { createdAt: "asc" }], include: MEASUREMENT_INCLUDE });
  return rows.map(presentMeasurement);
}

async function sheetScale(planSheetId: string): Promise<{ ptPerFt: number | null; scaleSource: string } | null> {
  return prisma.planSheet.findUnique({ where: { id: planSheetId }, select: { ptPerFt: true, scaleSource: true } });
}

/** A measurement drawn by a person: the value comes from the sheet's calibration; a length or area on an uncalibrated sheet is refused. */
export async function createMeasurement(takeoffId: string, input: CreateMeasurementInput, userId: string) {
  const takeoff = await prisma.takeoff.findUnique({ where: { id: takeoffId }, select: { trade: true, planSetId: true } });
  if (!takeoff) return null;
  const sheet = await prisma.planSheet.findFirst({ where: { id: input.planSheetId, planDocument: { planSetId: takeoff.planSetId } }, select: { id: true, ptPerFt: true, scaleSource: true } });
  if (!sheet) return { error: "That sheet is not in this takeoff's plan set" as const };
  const metric = metricFor(takeoff.trade, input.metricKey);
  if (!metric) return { error: "Unknown measurement type for this trade" as const };
  if (metric.kind !== input.kind) return { error: `${metric.label} is measured as ${metric.kind.toLowerCase()}` as const };
  const value = computeValue(input.kind, input.geometry, sheet.ptPerFt);
  if (!value) return { error: input.kind === "COUNT" ? "A count needs a point" : sheet.ptPerFt ? "Not enough points" : "This sheet is not calibrated yet — calibrate it before measuring lengths or areas" as const };
  const row = await prisma.takeoffMeasurement.create({
    data: {
      takeoffId,
      planSheetId: sheet.id,
      kind: input.kind,
      metricKey: input.metricKey,
      label: input.label,
      attributes: (input.attributes ?? undefined) as Prisma.InputJsonValue | undefined,
      geometry: input.geometry as Prisma.InputJsonValue,
      ptPerFt: input.kind === "COUNT" ? null : sheet.ptPerFt,
      valueRaw: value.valueRaw,
      unit: value.unit,
      origin: "MANUAL",
      confidence: "HIGH",
      reviewStatus: "APPROVED",
      createdByUserId: userId,
      reviewedByUserId: userId,
      reviewedAt: new Date(),
    },
    include: MEASUREMENT_INCLUDE,
  });
  await recordAudit({ actorUserId: userId, entityType: "takeoff_measurement", entityId: row.id, action: "create", after: { takeoffId, metricKey: input.metricKey, value: value.valueRaw, unit: value.unit } });
  return presentMeasurement(row);
}

/**
 * A change to a measurement. New geometry recomputes the value with the
 * sheet's current calibration and keeps the first replaced value; an AI
 * measurement edited by a person becomes MODIFIED. Review changes are
 * recorded with who and when.
 */
export async function updateMeasurement(id: string, patch: PatchMeasurementInput, userId: string) {
  const current = await prisma.takeoffMeasurement.findUnique({ where: { id }, include: { ...MEASUREMENT_INCLUDE, takeoff: { select: { trade: true } } } });
  if (!current) return null;
  const data: Prisma.TakeoffMeasurementUpdateInput = {};
  if (patch.metricKey !== undefined) {
    const metric = metricFor(current.takeoff.trade, patch.metricKey);
    if (!metric || metric.kind !== current.kind) return { error: "That measurement type does not fit this shape" as const };
    data.metricKey = patch.metricKey;
  }
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.attributes !== undefined) data.attributes = patch.attributes === null ? Prisma.DbNull : (patch.attributes as Prisma.InputJsonValue);
  if (patch.geometry) {
    const scale = current.kind === "COUNT" ? null : (await sheetScale(current.planSheetId))?.ptPerFt ?? null;
    const value = computeValue(current.kind, patch.geometry, scale);
    if (!value) return { error: current.kind === "COUNT" ? "A count needs a point" : scale ? "Not enough points" : "This sheet is not calibrated" as const };
    data.geometry = patch.geometry as Prisma.InputJsonValue;
    data.ptPerFt = current.kind === "COUNT" ? null : scale;
    data.valueRaw = value.valueRaw;
    if (current.previousValue == null && value.valueRaw !== current.valueRaw) data.previousValue = current.valueRaw;
    if (current.origin !== "MANUAL" && current.reviewStatus !== "EXCLUDED") data.reviewStatus = "MODIFIED";
  }
  if (patch.reviewStatus !== undefined) {
    data.reviewStatus = patch.reviewStatus;
    data.reviewedBy = { connect: { id: userId } };
    data.reviewedAt = new Date();
  }
  if (patch.note !== undefined) data.evidence = { ...((current.evidence as Record<string, unknown> | null) ?? {}), note: patch.note } as Prisma.InputJsonValue;
  const row = await prisma.takeoffMeasurement.update({ where: { id }, data, include: MEASUREMENT_INCLUDE });
  await recordAudit({ actorUserId: userId, entityType: "takeoff_measurement", entityId: id, action: "update", before: { valueRaw: current.valueRaw, reviewStatus: current.reviewStatus, label: current.label }, after: { ...patch, geometry: patch.geometry ? `${patch.geometry.points.length} points` : undefined, valueRaw: row.valueRaw } });
  return presentMeasurement(row);
}

export async function deleteMeasurement(id: string, userId: string) {
  const row = await prisma.takeoffMeasurement.delete({ where: { id }, select: { id: true, takeoffId: true, metricKey: true, valueRaw: true, unit: true, origin: true } });
  await recordAudit({ actorUserId: userId, entityType: "takeoff_measurement", entityId: id, action: "delete", before: row });
  return row;
}

/** Re-measure every length and area with its sheet's current calibration; the first replaced value is kept. */
export async function recomputeMeasurements(takeoffId: string, userId: string) {
  const rows = await prisma.takeoffMeasurement.findMany({ where: { takeoffId, kind: { not: "COUNT" } }, select: { id: true, kind: true, geometry: true, valueRaw: true, previousValue: true, ptPerFt: true, planSheet: { select: { ptPerFt: true } } } });
  let changed = 0, skipped = 0;
  for (const r of rows) {
    const scale = r.planSheet.ptPerFt;
    const value = scale ? computeValue(r.kind, r.geometry as { points: Pt[] }, scale) : null;
    if (!value) { skipped++; continue; }
    if (value.valueRaw === r.valueRaw && r.ptPerFt === scale) continue;
    await prisma.takeoffMeasurement.update({ where: { id: r.id }, data: { valueRaw: value.valueRaw, ptPerFt: scale, previousValue: r.previousValue ?? r.valueRaw } });
    changed++;
  }
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: takeoffId, action: "recompute", after: { changed, skipped } });
  return { changed, skipped, total: rows.length };
}

/**
 * Calibrate a sheet. `auto` checks the printed scale against the dimension
 * strings and their lines; `confirm` is a person accepting a printed scale;
 * `manual` is two clicks and a distance; `clear` forgets a hand calibration.
 * Measurements on the sheet are not touched: recomputing is its own action.
 */
export async function calibrateSheet(sheetId: string, input: CalibrateInput, userId: string) {
  const sheet = await prisma.planSheet.findUnique({ where: { id: sheetId }, select: { id: true, scaleText: true, scaleSource: true, ptPerFt: true, textKey: true, geometryKey: true, isRaster: true } });
  if (!sheet) return null;
  let verification: Verification | null = null;
  let data: Prisma.PlanSheetUpdateInput;
  if (input.mode === "auto") {
    if (sheet.isRaster) return { error: "A scanned sheet has no dimension text to check — calibrate it by hand" as const };
    const [text, geometry] = await Promise.all([readSheetText(sheet), readSheetGeometry(sheet)]);
    verification = verifyScale(sheet.scaleText, text?.items ?? [], (geometry?.segments ?? []).filter((s) => s.len >= 20));
    const cal = calibrationFrom(verification);
    if (!cal) return { error: verification.printedPtPerFt ? "The printed scale could not be checked" : "No scale is printed and the dimensions do not agree on one — calibrate by hand", verification };
    data = { scaleSource: cal.source, ptPerFt: cal.ptPerFt, scaleConfidence: cal.confidence, scaleVerification: verification as unknown as Prisma.InputJsonValue, calibratedBy: { connect: { id: userId } }, calibratedAt: new Date() };
  } else if (input.mode === "confirm") {
    if (!sheet.ptPerFt) return { error: "There is no printed scale to confirm" as const };
    data = { scaleSource: "AUTO_VERIFIED", scaleConfidence: 0.9, calibratedBy: { connect: { id: userId } }, calibratedAt: new Date() };
  } else if (input.mode === "manual") {
    const ptPerFt = manualCalibration(input.a, input.b, input.distanceFt);
    if (!ptPerFt) return { error: "The two points are too close together" as const };
    data = { scaleSource: "MANUAL", ptPerFt, scaleConfidence: 1, scaleVerification: { manual: { a: input.a, b: input.b, distanceFt: input.distanceFt } } as Prisma.InputJsonValue, calibratedBy: { connect: { id: userId } }, calibratedAt: new Date() };
  } else {
    data = { scaleSource: "NONE", ptPerFt: null, scaleConfidence: null, scaleVerification: Prisma.DbNull, calibratedBy: { disconnect: true }, calibratedAt: null };
  }
  const row = await prisma.planSheet.update({ where: { id: sheetId }, data, select: { id: true } });
  const updated = await prisma.planSheet.findUniqueOrThrow({ where: { id: row.id }, select: SHEET_SELECT_FOR_PRESENT });
  const affected = await prisma.takeoffMeasurement.count({ where: { planSheetId: sheetId, kind: { not: "COUNT" } } });
  await recordAudit({ actorUserId: userId, entityType: "plan_sheet", entityId: sheetId, action: "calibrate", before: { scaleSource: sheet.scaleSource, ptPerFt: sheet.ptPerFt }, after: { mode: input.mode, scaleSource: updated.scaleSource, ptPerFt: updated.ptPerFt, verdict: verification?.verdict } });
  return { sheet: presentSheet(updated), verification, affectedMeasurements: affected };
}

// the same columns `service.ts` presents, repeated here to avoid a circular value import
const SHEET_SELECT_FOR_PRESENT = {
  id: true, planDocumentId: true, pageNumber: true, widthPt: true, heightPt: true, rotation: true,
  sheetNumber: true, title: true, discipline: true, revisionLabel: true, scaleText: true, detected: true, indexConfidence: true, indexCorrectedByUserId: true,
  isRaster: true, textItemCount: true, segmentCount: true, textKey: true, renderKey72: true, renderKey144: true,
  scaleSource: true, ptPerFt: true, scaleConfidence: true, scaleVerification: true, supersededBySheetId: true, updatedAt: true,
} satisfies Prisma.PlanSheetSelect;

/**
 * A roofing takeoff read as a roof measurement (`roofing/to-measurement.ts`):
 * the preview the person checks, and — with `write` — the `RoofMeasurement`
 * the estimate builder prices like a Roofr report. With no sheets named, the
 * sheet with the largest reviewed roof area is chosen, with the sheets that
 * carry no roof area; ticking more brings the overlap warning.
 */
export async function roofMeasurementFromTakeoff(id: string, input: { sheetIds?: string[]; defaultRise: number }, userId: string, write: boolean) {
  const t = await prisma.takeoff.findUnique({ where: { id }, select: { id: true, number: true, trade: true, leadId: true, jobId: true } });
  if (!t) return null;
  if (t.trade !== "ROOFING") return { error: "Only a roofing takeoff can be priced as a roof", status: 400 } as const;
  const rows = await prisma.takeoffMeasurement.findMany({
    where: { takeoffId: id },
    orderBy: [{ planSheet: { pageNumber: "asc" } }, { createdAt: "asc" }],
    select: { id: true, planSheetId: true, metricKey: true, label: true, valueRaw: true, attributes: true, origin: true, reviewStatus: true, planSheet: { select: { sheetNumber: true, title: true } } },
  });
  const inputs: TakeoffRowInput[] = rows.map((r) => ({ ...r, sheetNumber: r.planSheet.sheetNumber, attributes: (r.attributes ?? null) as Record<string, unknown> | null }));

  const sheets = new Map<string, { id: string; sheetNumber: string | null; title: string | null; roofAreaSf: number; rows: number }>();
  for (const r of rows) {
    const s = sheets.get(r.planSheetId) ?? { id: r.planSheetId, sheetNumber: r.planSheet.sheetNumber, title: r.planSheet.title, roofAreaSf: 0, rows: 0 };
    s.rows++;
    sheets.set(r.planSheetId, s);
  }
  const everySheet = [...sheets.keys()];
  // A sheet's reviewed roof area, read through the same rules as the total.
  for (const s of sheets.values()) s.roofAreaSf = takeoffToMeasurement(inputs, { sheetIds: [s.id], defaultRise: 0 }).values.roofAreaSqFt ?? 0;
  const counting = (sheetId: string) => takeoffToMeasurement(inputs, { sheetIds: [sheetId], defaultRise: input.defaultRise }).counted > 0;
  // Default: never two sheets' roof areas at once (a set draws the same roof on
  // several sheets) — the largest roof plan, with every sheet that adds other rows.
  const largest = [...sheets.values()].filter((s) => s.roofAreaSf > 0).sort((a, b) => b.roofAreaSf - a.roofAreaSf)[0];
  const sheetIds = input.sheetIds ?? everySheet.filter((id) => counting(id) && (sheets.get(id)!.roofAreaSf === 0 || id === largest?.id));
  const unknown = sheetIds.find((s) => !sheets.has(s));
  if (unknown) return { error: "That sheet has no measurements in this takeoff", status: 400 } as const;

  const plan = takeoffToMeasurement(inputs, { sheetIds, defaultRise: input.defaultRise });
  const preview = { takeoff: { id: t.id, number: t.number }, sheets: [...sheets.values()], sheetIds, ...plan };
  if (!write) return { preview };
  if (!plan.pitchBands) return { error: "There is no reviewed roof area on the chosen sheets — approve the roof areas first", status: 409 } as const;

  const measurement = await createFromPlans({
    leadId: t.leadId,
    jobId: t.jobId,
    takeoffId: t.id,
    label: `Plans · ${t.number}`,
    values: plan.values,
    pitchBands: plan.pitchBands,
    reviewedShare: plan.reviewedShare,
    warnings: [...plan.warnings, ...plan.notPriced.map((p) => `Not priced by a takeoff rule: ${p.label} ${p.value} ${p.unit}`)],
    userId,
  });
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: t.id, action: "to_roof_measurement", after: { roofMeasurementId: measurement.id, sheetIds, totalSquares: plan.values.totalSquares, counted: plan.counted } });
  return { preview, measurement };
}
