import type { StepPlan, StepState } from "./plan";

/**
 * The steps of an ANALYZE_TAKEOFF job. Pure. One specs call over the
 * takeoff's text, then one regions call per roof plan sheet; the two kinds
 * do not depend on each other, so two ticks may run them side by side. The
 * runner moves the takeoff to review when every step is done.
 */
export const SPECS_STEP = "specs";

export const regionStepKey = (planSheetId: string) => `regions.${planSheetId}`;
export const sheetOfRegionStep = (stepKey: string): string | null => {
  const m = stepKey.match(/^regions\.(.+)$/);
  return m ? m[1] : null;
};

export function analyzeSteps(roofPlanSheetIds: readonly string[], withSpecs = true): StepPlan[] {
  const steps: StepPlan[] = [];
  if (withSpecs) steps.push({ sequence: 0, stepKey: SPECS_STEP, dependsOn: [] });
  for (const id of roofPlanSheetIds) steps.push({ sequence: 1, stepKey: regionStepKey(id), dependsOn: [] });
  return steps;
}

/** Progress line for the person watching; `names` maps a sheet id to its number. */
export function describeAnalyzeProgress(steps: readonly StepState[], names?: ReadonlyMap<string, string>): string {
  const specs = steps.find((s) => s.stepKey === SPECS_STEP);
  const regions = steps.filter((s) => sheetOfRegionStep(s.stepKey) !== null);
  const running = regions.find((s) => s.status === "RUNNING");
  const done = regions.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  const pending = regions.some((s) => s.status === "PENDING");
  if (specs?.status === "RUNNING") return "Reading the specifications";
  if (running) {
    const sheetId = sheetOfRegionStep(running.stepKey)!;
    return `Labelling ${names?.get(sheetId) ?? "a roof plan"} (${done + 1}/${regions.length})`;
  }
  if (specs?.status === "PENDING") return "Reading the specifications";
  if (pending) return `Labelling roof plans (${done}/${regions.length})`;
  if (steps.some((s) => s.status === "FAILED")) return "Stopped";
  return "Done";
}
