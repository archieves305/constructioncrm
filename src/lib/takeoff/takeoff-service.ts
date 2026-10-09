/**
 * Takeoffs, their sheets and measurements, and sheet calibration: the
 * database side. Numbers are computed by `measurement-value.ts` and the
 * geometry modules; nothing here decides a quantity.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import type { Pt } from "./geometry";
import { calibrationFrom, manualCalibration, verifyScale, type Verification } from "./geometry/calibrate";
import { computeValue } from "./measurement-value";
import { metricFor, type TradeName } from "./metrics";
import { readSheetGeometry, readSheetText } from "./sheet-cache";
import { presentSheet } from "./service";
import { proposeSheets } from "./sheets/relevance";
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
  _count: { select: { measurements: true } },
} satisfies Prisma.TakeoffInclude;

type TakeoffRow = Prisma.TakeoffGetPayload<{ include: typeof TAKEOFF_INCLUDE }>;

async function presentTakeoff(t: TakeoffRow) {
  const { planSet, _count, ...rest } = t;
  const pinned = (t.pinnedDocumentIds as string[]) ?? [];
  const counts = await prisma.takeoffMeasurement.groupBy({ by: ["reviewStatus"], where: { takeoffId: t.id }, _count: { _all: true } });
  return {
    ...rest,
    pinnedDocumentIds: pinned,
    planSet: { id: planSet.id, name: planSet.name },
    stale: planSet.documents.some((d) => !pinned.includes(d.id)),
    measurementCount: _count.measurements,
    byStatus: Object.fromEntries(counts.map((c) => [c.reviewStatus, c._count._all])) as Record<string, number>,
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

export async function updateTakeoff(id: string, patch: { status?: "DRAFT" | "IN_REVIEW" | "READY"; settings?: Record<string, unknown> }, userId: string) {
  const before = await prisma.takeoff.findUnique({ where: { id }, select: { status: true, settings: true } });
  if (!before) return null;
  const row = await prisma.takeoff.update({ where: { id }, data: { status: patch.status, settings: patch.settings as Prisma.InputJsonValue | undefined }, include: TAKEOFF_INCLUDE });
  await recordAudit({ actorUserId: userId, entityType: "takeoff", entityId: id, action: "update", before, after: patch });
  return presentTakeoff(row);
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
