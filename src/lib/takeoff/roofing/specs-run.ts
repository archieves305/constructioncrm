import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatAddressLine } from "@/lib/labels/address";
import { runAiCall } from "../ai/calls";
import { buildRoofSpecsInput, MAX_SPEC_SHEETS, ROOF_SPECS_PROMPT_VERSION, ROOF_SPECS_SYSTEM, type SpecsSheetInput } from "../ai/prompts";
import { RoofSpecsSchema } from "../ai/schemas";
import { readSheetText } from "../sheet-cache";
import { linesOf } from "../sheets/text-lines";
import { saveRoofSpecs } from "../takeoff-service";

/** The sheets the specs call reads, in this order: the roof plans, the notes, then the details. */
const SPECS_ROLE_ORDER = ["roof_plan", "notes", "roof_details"] as const;

/**
 * The specs step of a roofing analysis: the text of the takeoff's sheets,
 * with line ids, to the model; its reading of the assembly saved on the
 * takeoff. "Not specified" is a valid, expected answer.
 */
export async function runRoofSpecs(takeoffId: string, userId: string): Promise<Prisma.InputJsonValue> {
  const takeoff = await prisma.takeoff.findUnique({
    where: { id: takeoffId },
    select: {
      id: true,
      lead: { select: { propertyAddress1: true, city: true, state: true, zipCode: true } },
      sheets: { select: { role: true, planSheet: { select: { id: true, sheetNumber: true, title: true, pageNumber: true, textKey: true, isRaster: true } } } },
    },
  });
  if (!takeoff) throw new Error("takeoff is gone");
  const ranked = takeoff.sheets
    .filter((s) => s.role && (SPECS_ROLE_ORDER as readonly string[]).includes(s.role) && !s.planSheet.isRaster)
    .sort((a, b) => SPECS_ROLE_ORDER.indexOf(a.role as (typeof SPECS_ROLE_ORDER)[number]) - SPECS_ROLE_ORDER.indexOf(b.role as (typeof SPECS_ROLE_ORDER)[number]) || a.planSheet.pageNumber - b.planSheet.pageNumber)
    .slice(0, MAX_SPEC_SHEETS);
  const sheets: SpecsSheetInput[] = [];
  for (const s of ranked) {
    const text = await readSheetText(s.planSheet);
    if (!text?.items.length) continue;
    sheets.push({ sheetNumber: s.planSheet.sheetNumber ?? `p.${s.planSheet.pageNumber}`, title: s.planSheet.title, lines: linesOf(text.items).map((l, i) => ({ id: `L${i}`, text: l.text })) });
  }
  if (!sheets.length) return { skipped: "no readable sheet is selected for the specifications" };
  const address = formatAddressLine(takeoff.lead);
  const input = buildRoofSpecsInput(sheets, { address });
  const res = await runAiCall({
    takeoffId,
    purpose: "roof_specs",
    promptVersion: ROOF_SPECS_PROMPT_VERSION,
    schema: RoofSpecsSchema,
    inputs: { address, sheets: sheets.map((s) => ({ sheetNumber: s.sheetNumber, lines: s.lines })) },
    system: ROOF_SPECS_SYSTEM,
    content: input,
    effort: "high",
    maxTokens: 8_000,
    userId,
  });
  await saveRoofSpecs(takeoffId, res.output, { aiCallId: res.callId, promptVersion: ROOF_SPECS_PROMPT_VERSION, sheets: sheets.map((s) => s.sheetNumber) });
  return { assembly: res.output.assembly?.type ?? null, notSpecified: res.output.notSpecified.length, sheets: sheets.length, cached: res.cached, costUsd: res.costUsd, ms: res.durationMs };
}
