import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { runAiCall } from "../ai/calls";
import { PROMPT_SEGMENTS, roofCandidates } from "../ai/candidates";
import { buildRoofRegionsPrompt, ROOF_REGIONS_PROMPT_VERSION, ROOF_REGIONS_SYSTEM } from "../ai/prompts";
import { aiImageFor } from "../ai/render";
import { RoofRegionsSchema } from "../ai/schemas";
import { readSheetGeometry, readSheetText } from "../sheet-cache";
import { replaceAiMeasurements } from "../takeoff-service";
import { describeRegionsSummary, measurementsFromRegions } from "./analyze";

/**
 * The regions step of a roofing analysis on one roof plan: the sheet's
 * picture with the ids of its labels and longest lines to the model, its
 * labelling turned into measurements by code, written as proposals that
 * replace the sheet's earlier unreviewed proposals. A sheet that is scanned
 * or not calibrated is skipped and says why.
 */
export async function runRoofRegions(takeoffId: string, planSheetId: string, userId: string): Promise<Prisma.InputJsonValue> {
  const sheet = await prisma.planSheet.findUnique({
    where: { id: planSheetId },
    select: { id: true, pageNumber: true, sheetNumber: true, title: true, widthPt: true, heightPt: true, scaleText: true, ptPerFt: true, isRaster: true, textKey: true, geometryKey: true, planDocument: { select: { id: true, file: { select: { storageKey: true } } } } },
  });
  if (!sheet) throw new Error("sheet is gone");
  const sheetNumber = sheet.sheetNumber ?? `p.${sheet.pageNumber}`;
  if (sheet.isRaster) return { skipped: `${sheetNumber} is a scanned sheet — measure it by hand` };
  if (!sheet.ptPerFt) return { skipped: `${sheetNumber} is not calibrated — calibrate it and analyse again` };
  const [text, geometry] = await Promise.all([readSheetText(sheet), readSheetGeometry(sheet)]);
  const cand = roofCandidates(text, geometry);
  if (!cand.segments.length) return { skipped: `${sheetNumber} has no drawn lines to work from` };

  const img = await aiImageFor(sheet);
  const px = (v: number) => Math.round(v * img.pxPerPt);
  const listed = cand.segments.slice(0, PROMPT_SEGMENTS);
  const prompt = buildRoofRegionsPrompt({
    sheetNumber,
    title: sheet.title,
    imageWidthPx: img.widthPx,
    imageHeightPx: img.heightPx,
    pxPerPt: img.pxPerPt,
    ptPerFt: sheet.ptPerFt,
    scaleText: sheet.scaleText,
    labels: cand.labels.map((l) => ({ id: l.id, str: l.str, xPx: px(l.x), yPx: px(l.y) })),
    segments: listed.map((s) => ({ id: s.id, x1Px: px(s.x1), y1Px: px(s.y1), x2Px: px(s.x2), y2Px: px(s.y2), lenFt: s.len / sheet.ptPerFt! })),
  });
  const res = await runAiCall({
    takeoffId,
    planSheetId,
    purpose: "roof_regions",
    promptVersion: ROOF_REGIONS_PROMPT_VERSION,
    schema: RoofRegionsSchema,
    inputs: { planSheetId, dpi: img.dpi, ptPerFt: sheet.ptPerFt, labels: cand.labels, segments: listed },
    system: ROOF_REGIONS_SYSTEM,
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: img.base64 } },
      { type: "text", text: prompt },
    ],
    effort: "high",
    maxTokens: 16_000,
    userId,
  });
  const { measurements, summary } = measurementsFromRegions(res.output, { pxPerPt: img.pxPerPt, ptPerFt: sheet.ptPerFt, labels: cand.labels, segments: cand.segments, snapSegments: cand.segments }, res.callId);
  const written = await replaceAiMeasurements(takeoffId, planSheetId, measurements, "roof_regions");
  return {
    sheet: sheetNumber,
    summary: describeRegionsSummary(summary),
    ...summary,
    created: written.created,
    replaced: written.replaced,
    unmeasurable: written.skipped,
    assemblyNamedOnSheet: res.output.assemblyIdentifiedOnThisSheet,
    notes: res.output.notes.slice(0, 200),
    cached: res.cached,
    costUsd: res.costUsd,
    ms: res.durationMs,
  };
}
