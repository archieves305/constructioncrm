import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { readFile } from "@/lib/files/storage";
import { runAiCall } from "@/lib/ai/calls";
import { AiError } from "@/lib/ai/client";
import { parseBoxes, tierFor } from "./boxes";
import { isQualityProfile, type InspectionKind } from "./catalog";
import * as area from "./prompt";
import { planAnswer, type KnownFinding, type Verdict } from "./state";

/**
 * One AI look at a batch of an area's photos. Photos join the area's QUEUED
 * batch (up to BATCH of them) and the batch waits `DEBOUNCE_MS` after the
 * last one, so a few shots taken together go in one call. A run claims its
 * row first; a run cut off by a restart is taken up by the minute cron once
 * stale. Never throws: a failure is written on the row for the person.
 */
export const BATCH = 6;
export const DEBOUNCE_MS = 6_000;
export const STALE_MS = 4 * 60_000;
export const MAX_ATTEMPTS = 3;
const RETRY_MS = 30_000;
const READABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A new photo: into the area's waiting batch, or a new one. Returns the batch id. */
export async function queuePhoto(inspectionId: string, areaId: string | null, photoId: string, userId: string | null): Promise<string> {
  const notBefore = new Date(Date.now() + DEBOUNCE_MS);
  const waiting = await prisma.qualityInspectionAnalysis.findFirst({
    where: { inspectionId, areaId, status: "QUEUED", mode: "standard", attempts: 0 },
    orderBy: { createdAt: "desc" },
    select: { id: true, _count: { select: { photos: true } } },
  });
  if (waiting && waiting._count.photos < BATCH) {
    await prisma.$transaction([
      prisma.qualityInspectionPhoto.update({ where: { id: photoId }, data: { analysisId: waiting.id } }),
      prisma.qualityInspectionAnalysis.update({ where: { id: waiting.id }, data: { notBefore } }),
    ]);
    return waiting.id;
  }
  const created = await prisma.qualityInspectionAnalysis.create({
    data: { inspectionId, areaId, notBefore, requestedByUserId: userId, photos: { connect: { id: photoId } } },
    select: { id: true },
  });
  return created.id;
}

/**
 * Look again: the area's latest photos (up to BATCH) with the more capable
 * model ("closer"), or the photos of a failed batch with the usual one.
 */
export async function requestAnalysis(inspectionId: string, areaId: string | null, mode: "closer" | "retry", userId: string): Promise<string | null> {
  if (mode === "retry") {
    const failed = await prisma.qualityInspectionAnalysis.findMany({ where: { inspectionId, areaId, status: "FAILED" }, select: { id: true } });
    if (!failed.length) return null;
    await prisma.qualityInspectionAnalysis.updateMany({ where: { id: { in: failed.map((f) => f.id) } }, data: { status: "QUEUED", attempts: 0, startedAt: null, error: null, notBefore: new Date(), requestedByUserId: userId } });
    return failed[0].id;
  }
  if (!(await prisma.qualityInspectionPhoto.count({ where: { inspectionId, areaId, role: "ORIGINAL" } }))) return null;
  // the photos stay on the batch that first read them; a closer look reads
  // the area's latest ones when it runs
  const created = await prisma.qualityInspectionAnalysis.create({
    data: { inspectionId, areaId, mode: "closer", notBefore: new Date(), requestedByUserId: userId },
    select: { id: true },
  });
  return created.id;
}

async function photosFor(a: { id: string; mode: string; inspectionId: string; areaId: string | null }) {
  const select = { id: true, width: true, height: true, file: { select: { storageKey: true, fileType: true } } } satisfies Prisma.QualityInspectionPhotoSelect;
  if (a.mode === "closer") {
    const rows = await prisma.qualityInspectionPhoto.findMany({ where: { inspectionId: a.inspectionId, areaId: a.areaId, role: "ORIGINAL" }, orderBy: { createdAt: "desc" }, take: BATCH, select });
    return rows.reverse();
  }
  return prisma.qualityInspectionPhoto.findMany({ where: { analysisId: a.id }, orderBy: { createdAt: "asc" }, select });
}

async function claim(id: string): Promise<boolean> {
  const now = new Date();
  const res = await prisma.qualityInspectionAnalysis.updateMany({
    where: {
      id,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "QUEUED", notBefore: { lte: now } },
        { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      ],
    },
    data: { status: "RUNNING", startedAt: now, attempts: { increment: 1 } },
  });
  return res.count > 0;
}

export async function runAnalysis(id: string): Promise<void> {
  if (!(await claim(id))) return;
  const a = await prisma.qualityInspectionAnalysis.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      mode: true,
      attempts: true,
      inspectionId: true,
      areaId: true,
      requestedByUserId: true,
      inspection: { select: { kind: true, qualityProfile: true, scopeText: true, status: true, areas: { select: { id: true, name: true } } } },
      area: { select: { name: true, trade: true } },
    },
  });
  const fail = async (error: string, retry: boolean) => {
    const again = retry && a.attempts < MAX_ATTEMPTS;
    await prisma.qualityInspectionAnalysis.update({
      where: { id },
      data: again ? { status: "QUEUED", notBefore: new Date(Date.now() + RETRY_MS), error: error.slice(0, 500) } : { status: "FAILED", finishedAt: new Date(), error: error.slice(0, 500) },
    });
  };
  try {
    if (a.inspection.status !== "OPEN") return void (await fail("The inspection was closed before this batch was read.", false));
    const rows = await photosFor(a);
    const photos: area.PhotoInput[] = [];
    const answerPhotos: { n: number; id: string; width: number; height: number }[] = [];
    for (const r of rows) {
      if (!READABLE.has(r.file.fileType)) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(r.file.storageKey);
      } catch {
        continue;
      }
      const n = photos.length + 1;
      photos.push({ n, base64: bytes.toString("base64"), mediaType: r.file.fileType as area.PhotoInput["mediaType"], width: r.width, height: r.height });
      answerPhotos.push({ n, id: r.id, width: r.width, height: r.height });
    }
    if (!photos.length) return void (await fail("None of these photos could be read. Take them again.", false));

    const existing = await prisma.qualityInspectionFinding.findMany({
      where: { inspectionId: a.inspectionId, areaId: a.areaId, review: { not: "DISMISSED" } },
      select: { id: true, trade: true, title: true, photoId: true, relatedPhotoIds: true, boxes: true },
    });
    const known: KnownFinding[] = existing.map((f) => ({
      id: f.id,
      trade: f.trade,
      title: f.title,
      photoIds: [f.photoId, ...(Array.isArray(f.relatedPhotoIds) ? (f.relatedPhotoIds as string[]) : [])].filter((p): p is string => !!p),
      boxes: parseBoxes(f.boxes),
      boxPhotoId: f.photoId,
    }));
    const ctx: area.AreaContext = {
      kind: a.inspection.kind as InspectionKind,
      profile: isQualityProfile(a.inspection.qualityProfile) ? a.inspection.qualityProfile : "standard",
      area: a.area?.name ?? "General",
      trade: a.area?.trade ?? null,
      scopeText: a.inspection.scopeText,
      known: existing.map((f) => f.title),
      otherAreas: a.inspection.areas.filter((x) => x.id !== a.areaId).map((x) => x.name),
    };
    const model = a.mode === "closer" ? env.INSPECTOR_CLOSER_MODEL : env.INSPECTOR_MODEL;
    const result = await runAiCall({
      subjectType: "inspection",
      subjectId: a.inspectionId,
      purpose: area.PURPOSE,
      promptVersion: area.PROMPT_VERSION,
      schema: area.schema,
      inputs: { photos: answerPhotos.map((p) => p.id), ctx, mode: a.mode },
      system: area.SYSTEM,
      content: area.content(ctx, photos),
      model,
      effort: a.mode === "closer" ? "high" : "medium",
      maxTokens: 12_000,
      userId: a.requestedByUserId,
    });
    const plan = planAnswer(result.output, answerPhotos, tierFor(result.model), known);
    await prisma.$transaction(async (tx) => {
      for (const f of plan.findings) {
        await tx.qualityInspectionFinding.create({
          data: {
            inspectionId: a.inspectionId,
            areaId: a.areaId,
            photoId: f.photoId,
            relatedPhotoIds: f.relatedPhotoIds,
            source: "AI",
            analysisId: id,
            kind: f.kind,
            trade: f.trade,
            title: f.title,
            evidence: f.evidence,
            severity: f.severity,
            confidence: f.confidence,
            action: f.action,
            physicalCheck: f.physicalCheck,
            boxes: f.boxes,
            aiOriginal: f.aiOriginal as Prisma.InputJsonValue,
          },
        });
      }
      for (const r of plan.repeats) {
        const row = existing.find((e) => e.id === r.findingId);
        const prev = Array.isArray(row?.relatedPhotoIds) ? (row!.relatedPhotoIds as string[]) : [];
        await tx.qualityInspectionFinding.update({ where: { id: r.findingId }, data: { relatedPhotoIds: [...new Set([...prev, ...r.photoIds])] } });
      }
      for (const q of plan.photoQuality) await tx.qualityInspectionPhoto.update({ where: { id: q.photoId }, data: { quality: q.quality } });
      if (a.areaId) {
        const open = existing.length + plan.findings.length > 0;
        const verdict: Verdict = plan.verdict === "looks_complete" && open ? "issues_found" : plan.verdict;
        await tx.qualityInspectionArea.update({ where: { id: a.areaId }, data: { verdict, summary: plan.summary || null, photosNeeded: plan.photosNeeded } });
      }
      await tx.qualityInspectionAnalysis.update({
        where: { id },
        data: { status: "DONE", finishedAt: new Date(), aiCallId: result.callId, model: result.model, costUsd: result.costUsd, durationMs: result.durationMs, error: null },
      });
    });
    logger.info("inspection analysis", { inspectionId: a.inspectionId, analysisId: id, photos: photos.length, findings: plan.findings.length, repeats: plan.repeats.length, costUsd: result.costUsd, durationMs: result.durationMs, model: result.model, cached: result.cached });
  } catch (err) {
    if (err instanceof AiError) {
      // a cap, a missing key or a refusal will not change on retry; a busy or failing service may
      const retry = err.code === "rate_limited" || err.code === "upstream" || err.code === "cut_off";
      await fail(err.message, retry);
      return;
    }
    logger.exception(err, { where: "inspector.runAnalysis", analysisId: id });
    await fail("Something went wrong reading these photos.", true);
  }
}

/** Run what is due: for one inspection (after an upload), or everything (the cron). Two at a time. */
export async function runDue(opts: { inspectionId?: string; limit?: number } = {}): Promise<number> {
  const now = new Date();
  const due = await prisma.qualityInspectionAnalysis.findMany({
    where: {
      ...(opts.inspectionId ? { inspectionId: opts.inspectionId } : {}),
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "QUEUED", notBefore: { lte: now } },
        { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      ],
    },
    orderBy: { notBefore: "asc" },
    take: opts.limit ?? 8,
    select: { id: true },
  });
  const ids = due.map((d) => d.id);
  let i = 0;
  const worker = async () => {
    while (i < ids.length) await runAnalysis(ids[i++]);
  };
  await Promise.all([worker(), worker()]);
  // a run that hit its last attempt while RUNNING and then went stale is closed
  await prisma.qualityInspectionAnalysis.updateMany({
    where: { status: "RUNNING", attempts: { gte: MAX_ATTEMPTS }, startedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    data: { status: "FAILED", finishedAt: now, error: "Reading these photos did not finish. Try again." },
  });
  return ids.length;
}

/** After an upload: wait out the batch window, then run what is due for this inspection. */
export async function kickAfterUpload(inspectionId: string): Promise<void> {
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 500));
  await runDue({ inspectionId, limit: 4 }).catch((err) => logger.exception(err, { where: "inspector.kickAfterUpload", inspectionId }));
}
