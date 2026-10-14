import type { Prisma } from "@/generated/prisma/client";
import { runRoofRegions } from "../roofing/regions-run";
import { runRoofSpecs } from "../roofing/specs-run";
import { sheetOfRegionStep, SPECS_STEP } from "./analyze-plan";

/**
 * What each analysis step does. Idempotent like the index steps: a step run
 * twice asks the model nothing new (the recorded answer is reused) and
 * rewrites only the proposals nobody has reviewed.
 */
export type AnalyzeContext = { jobId: string; takeoffId: string; stepKey: string; userId: string };

export async function runAnalyzeStep(ctx: AnalyzeContext): Promise<Prisma.InputJsonValue> {
  if (ctx.stepKey === SPECS_STEP) return runRoofSpecs(ctx.takeoffId, ctx.userId);
  const sheetId = sheetOfRegionStep(ctx.stepKey);
  if (sheetId) return runRoofRegions(ctx.takeoffId, sheetId, ctx.userId);
  throw new Error(`unknown step ${ctx.stepKey}`);
}
