import { prisma } from "@/lib/db/prisma";
import { ensureStorageDir, resolveStoragePath } from "@/lib/files/storage";
import { isRasterPage, MAX_PLAN_PAGES } from "../limits";
import { extractPages, inventoryPdf } from "../pdf/worker-client";
import { documentArtifactKey, readSheetText } from "../sheet-cache";
import { classifyPage, documentSheetList, type PageForIndex } from "../sheets/classify";
import { parseScaleText } from "../sheets/scale";
import type { DetectedIndex } from "../types";
import { CLASSIFY_STEP, INVENTORY_STEP, pageIndexSteps, pageOfStep, SCALE_STEP } from "./plan";
import type { Prisma } from "@/generated/prisma/client";

/**
 * What each index step does. Every handler is idempotent: run twice, it
 * rewrites its own output and nothing else, so a step reclaimed after a
 * crash cannot duplicate anything.
 */
export type StepContext = { jobId: string; planDocumentId: string; stepKey: string };

export async function runIndexStep(ctx: StepContext): Promise<Prisma.InputJsonValue> {
  if (ctx.stepKey === INVENTORY_STEP) return inventory(ctx);
  const page = pageOfStep(ctx.stepKey);
  if (page !== null) return extractPage(ctx, page);
  if (ctx.stepKey === CLASSIFY_STEP) return classify(ctx);
  if (ctx.stepKey === SCALE_STEP) return scales(ctx);
  throw new Error(`unknown step ${ctx.stepKey}`);
}

async function documentOf(ctx: StepContext) {
  const doc = await prisma.planDocument.findUnique({ where: { id: ctx.planDocumentId }, select: { id: true, status: true, file: { select: { storageKey: true } } } });
  if (!doc) throw new Error("document is gone");
  return doc;
}

/** Open the PDF, create one sheet row per page and the steps that read them. */
async function inventory(ctx: StepContext) {
  const doc = await documentOf(ctx);
  const inv = await inventoryPdf(resolveStoragePath(doc.file.storageKey));
  if (inv.pages > MAX_PLAN_PAGES) throw new Error(`the set has ${inv.pages} pages; the limit is ${MAX_PLAN_PAGES} — split it and upload the parts`);
  if (inv.pages === 0) throw new Error("the PDF has no pages");
  await prisma.$transaction(async (tx) => {
    await tx.planDocument.update({ where: { id: doc.id }, data: { pageCount: inv.pages, status: "INDEXING" } });
    for (const s of inv.sizes) {
      await tx.planSheet.upsert({
        where: { planDocumentId_pageNumber: { planDocumentId: doc.id, pageNumber: s.page } },
        create: { planDocumentId: doc.id, pageNumber: s.page, widthPt: s.widthPt, heightPt: s.heightPt, rotation: s.rotation },
        update: { widthPt: s.widthPt, heightPt: s.heightPt, rotation: s.rotation },
      });
    }
    await tx.planJobStep.createMany({ data: pageIndexSteps(inv.pages).map((s) => ({ jobId: ctx.jobId, sequence: s.sequence, stepKey: s.stepKey, dependsOn: s.dependsOn })), skipDuplicates: true });
    await tx.planJob.update({ where: { id: ctx.jobId }, data: { totalSteps: 1 + pageIndexSteps(inv.pages).length } });
  });
  return { pages: inv.pages };
}

/** Text, drawn segments and the 72 dpi render of one page, written beside the document. */
async function extractPage(ctx: StepContext, pageNumber: number) {
  const doc = await documentOf(ctx);
  const dirKey = documentArtifactKey(doc.id);
  const outDir = await ensureStorageDir(dirKey);
  const [result] = await extractPages({ pdfPath: resolveStoragePath(doc.file.storageKey), outDir, pages: [pageNumber], renders: [72] });
  if (!result) throw new Error(`page ${pageNumber} produced nothing`);
  await prisma.planSheet.update({
    where: { planDocumentId_pageNumber: { planDocumentId: doc.id, pageNumber } },
    data: {
      widthPt: result.widthPt,
      heightPt: result.heightPt,
      rotation: result.rotation,
      textItemCount: result.textItems,
      segmentCount: result.segments,
      isRaster: isRasterPage(result.textItems, result.segments),
      textKey: result.files.text ? `${dirKey}/${result.files.text}` : null,
      geometryKey: result.files.geometry ? `${dirKey}/${result.files.geometry}` : null,
      renderKey72: result.files.renders["72"] ? `${dirKey}/${result.files.renders["72"]}` : null,
    },
  });
  return { textItems: result.textItems, segments: result.segments, ms: result.ms };
}

/** Sheet number, title, discipline and scale for every page, from the title blocks checked against the sheet list. */
async function classify(ctx: StepContext) {
  const doc = await documentOf(ctx);
  const sheets = await prisma.planSheet.findMany({ where: { planDocumentId: doc.id }, orderBy: { pageNumber: "asc" } });
  const pages: (PageForIndex & { id: string; corrected: boolean })[] = [];
  for (const s of sheets) {
    const text = await readSheetText(s);
    pages.push({ id: s.id, corrected: !!s.indexCorrectedByUserId, pageNumber: s.pageNumber, widthPt: s.widthPt, heightPt: s.heightPt, items: text?.items ?? [] });
  }
  const list = documentSheetList(pages);
  let indexed = 0;
  for (const p of pages) {
    const detected: DetectedIndex = classifyPage(p, list);
    const inForce = p.corrected
      ? {}
      : { sheetNumber: detected.sheetNumber, title: detected.title, discipline: detected.discipline, scaleText: detected.scaleText, revisionLabel: detected.revisionLabel };
    await prisma.planSheet.update({ where: { id: p.id }, data: { ...inForce, detected: detected as unknown as Prisma.InputJsonValue, indexConfidence: detected.confidence } });
    if (detected.sheetNumber) indexed++;
  }
  return { sheets: pages.length, withNumber: indexed, sheetList: list.found };
}

/** The printed scale of every sheet becomes its AUTO calibration until a person confirms or replaces it. */
async function scales(ctx: StepContext) {
  const doc = await documentOf(ctx);
  const sheets = await prisma.planSheet.findMany({ where: { planDocumentId: doc.id }, select: { id: true, scaleText: true, scaleSource: true } });
  let set = 0;
  for (const s of sheets) {
    if (s.scaleSource !== "NONE" && s.scaleSource !== "AUTO") continue;
    const parsed = s.scaleText ? parseScaleText(s.scaleText) : null;
    const ptPerFt = parsed && !parsed.nts ? parsed.ptPerFt : null;
    await prisma.planSheet.update({ where: { id: s.id }, data: ptPerFt ? { scaleSource: "AUTO", ptPerFt, scaleConfidence: 0.6 } : { scaleSource: "NONE", ptPerFt: null, scaleConfidence: null } });
    if (ptPerFt) set++;
  }
  await prisma.planDocument.update({ where: { id: doc.id }, data: { status: "INDEXED", indexedAt: new Date(), error: null } });
  return { calibrated: set, of: sheets.length };
}
