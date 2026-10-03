/**
 * Roof measurements: the database side. The parsing and the rules live in the
 * pure files beside this one; this file reads and writes rows and nothing
 * else decides anything here.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { fileExists, saveFile } from "@/lib/files/storage";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { applyEdits, columnsFromParse, MEASUREMENT_KEYS, reviewState, validBands, type MeasurementValues, type Overrides } from "./measurements";
import { parseRoofrPdf } from "./parsing/roofr";

const INCLUDE = {
  file: { select: { id: true, fileName: true, storageKey: true } },
  job: { select: JOB_LABEL_SELECT },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.RoofMeasurementInclude;

type Row = Prisma.RoofMeasurementGetPayload<{ include: typeof INCLUDE }>;

function valuesOf(row: Row): MeasurementValues {
  const v: Record<string, unknown> = {};
  for (const k of MEASUREMENT_KEYS) v[k] = row[k];
  return v as MeasurementValues;
}

/** A measurement as the screens see it. The raw extract and storage key stay on the server. */
async function present(row: Row) {
  const { rawExtract: _raw, file, ...rest } = row;
  void _raw;
  const values = valuesOf(row);
  return {
    ...rest,
    pitchBands: validBands(row.pitchBands),
    file: file ? { id: file.id, fileName: file.fileName, missing: !(await fileExists(file.storageKey)) } : null,
    review: reviewState({ source: row.source, parseConfidence: row.parseConfidence, fieldConfidence: row.fieldConfidence, overrides: row.overrides, reviewedAt: row.reviewedAt, values }),
  };
}

export type PresentedMeasurement = Awaited<ReturnType<typeof present>>;

export async function listMeasurements(leadId: string) {
  const rows = await prisma.roofMeasurement.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, include: INCLUDE });
  return Promise.all(rows.map(present));
}

/** A measurement belongs to the job when the caller says so, or when the lead has exactly one job. */
async function jobFor(leadId: string, jobId: string | null): Promise<string | null> {
  if (jobId) return jobId;
  const jobs = await prisma.job.findMany({ where: { leadId }, select: { id: true }, take: 2 });
  return jobs.length === 1 ? jobs[0].id : null;
}

/**
 * A measurement report (PDF): read it, keep the document as a file on the
 * lead, and store what was read. A report that cannot be read is still kept,
 * with an empty measurement for a person to fill in — the upload is never lost.
 */
export async function createFromReport(input: { leadId: string; jobId: string | null; buffer: Buffer; fileName: string; fileType: string; userId: string }) {
  const parse = await parseRoofrPdf(input.buffer);
  const jobId = await jobFor(input.leadId, input.jobId);
  const stored = await saveFile(input.buffer, input.fileName);
  const columns = columnsFromParse(parse);
  const row = await prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: { leadId: input.leadId, jobId, fileName: input.fileName, fileType: input.fileType, fileSize: stored.bytes, storageKey: stored.storageKey, category: "MEASUREMENT_REPORT", uploadedByUserId: input.userId },
      select: { id: true },
    });
    return tx.roofMeasurement.create({
      data: {
        ...columns,
        pitchBands: (columns.pitchBands ?? undefined) as Prisma.InputJsonValue | undefined,
        reportWasteOptions: columns.reportWasteOptions ?? undefined,
        leadId: input.leadId,
        jobId,
        fileId: file.id,
        source: "ROOFR",
        createdByUserId: input.userId,
      },
      include: INCLUDE,
    });
  });
  await recordAudit({ actorUserId: input.userId, entityType: "roof_measurement", entityId: row.id, action: "create", after: { source: "ROOFR", fileName: input.fileName, confidence: parse.confidence, totalSquares: row.totalSquares } });
  return present(row);
}

export async function createManual(input: { leadId: string; jobId: string | null; label: string | null; source: "MANUAL" | "FIELD"; values: MeasurementValues; userId: string }) {
  const row = await prisma.roofMeasurement.create({
    data: { ...input.values, leadId: input.leadId, jobId: await jobFor(input.leadId, input.jobId), label: input.label, source: input.source, createdByUserId: input.userId },
    include: INCLUDE,
  });
  await recordAudit({ actorUserId: input.userId, entityType: "roof_measurement", entityId: row.id, action: "create", after: { source: input.source, totalSquares: row.totalSquares } });
  return present(row);
}

export async function updateMeasurement(id: string, input: { values?: MeasurementValues; label?: string | null; reviewed?: boolean; userId: string }) {
  const current = await prisma.roofMeasurement.findUnique({ where: { id }, include: INCLUDE });
  if (!current) return null;
  const now = new Date();
  const edit = applyEdits(valuesOf(current), current.overrides as Overrides | null, input.values ?? {}, input.userId, now);
  const data: Prisma.RoofMeasurementUpdateInput = { ...edit.data };
  if (edit.changed.length) data.overrides = edit.overrides as Prisma.InputJsonValue;
  if (input.label !== undefined) data.label = input.label;
  if (input.reviewed === true && !current.reviewedAt) {
    data.reviewedAt = now;
    data.reviewedBy = { connect: { id: input.userId } };
  }
  if (input.reviewed === false && current.reviewedAt) {
    data.reviewedAt = null;
    data.reviewedBy = { disconnect: true };
  }
  if (Object.keys(data).length === 0) return present(current);
  const row = await prisma.roofMeasurement.update({ where: { id }, data, include: INCLUDE });
  const before: Record<string, unknown> = {};
  for (const k of edit.changed) before[k] = current[k];
  await recordAudit({ actorUserId: input.userId, entityType: "roof_measurement", entityId: id, action: "update", before, after: { ...edit.data, ...(input.reviewed !== undefined ? { reviewed: input.reviewed } : {}) } });
  return present(row);
}

/** Removes the measurement. The report it came from stays on the lead's files. */
export async function deleteMeasurement(id: string, userId: string) {
  const row = await prisma.roofMeasurement.delete({ where: { id }, select: { id: true, leadId: true, source: true, totalSquares: true, fileId: true } });
  await recordAudit({ actorUserId: userId, entityType: "roof_measurement", entityId: id, action: "delete", before: row });
}
