import type { PlanJobStatusName, PlanJobStepStatusName } from "../types";

/**
 * The steps that index a document, and how a job's status follows its steps.
 * Pure: the runner persists these, the handlers run them.
 */
export type StepPlan = { sequence: number; stepKey: string; dependsOn: string[] };

export const INVENTORY_STEP = "inventory";
export const CLASSIFY_STEP = "classify";
export const SCALE_STEP = "scale";

export const pageStepKey = (pageNumber: number) => `page.${pageNumber}`;
export const pageOfStep = (stepKey: string): number | null => {
  const m = stepKey.match(/^page\.(\d+)$/);
  return m ? Number(m[1]) : null;
};

/** A new index job knows only that it must look at the document first. */
export function initialIndexSteps(): StepPlan[] {
  return [{ sequence: 0, stepKey: INVENTORY_STEP, dependsOn: [] }];
}

/** Once the page count is known: one step per page, then the classification over all pages, then the scales. */
export function pageIndexSteps(pageCount: number): StepPlan[] {
  const pages = Array.from({ length: pageCount }, (_, i) => ({ sequence: 1, stepKey: pageStepKey(i + 1), dependsOn: [INVENTORY_STEP] }));
  return [
    ...pages,
    { sequence: 2, stepKey: CLASSIFY_STEP, dependsOn: pages.map((p) => p.stepKey) },
    { sequence: 3, stepKey: SCALE_STEP, dependsOn: [CLASSIFY_STEP] },
  ];
}

export type StepState = { stepKey: string; status: PlanJobStepStatusName; dependsOn: string[] };

/** Steps that may run now: pending, with every dependency done or skipped. */
export function runnableSteps(steps: readonly StepState[]): StepState[] {
  const finished = new Set(steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").map((s) => s.stepKey));
  return steps.filter((s) => s.status === "PENDING" && s.dependsOn.every((d) => finished.has(d)));
}

export type JobRollup = { status: PlanJobStatusName; totalSteps: number; doneSteps: number; failedSteps: number };

/** A job is done when every step is; failed when any step is and nothing is left to run; otherwise it is running. */
export function rollupJob(steps: readonly StepState[], current: PlanJobStatusName): JobRollup {
  const totalSteps = steps.length;
  const doneSteps = steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  const failedSteps = steps.filter((s) => s.status === "FAILED").length;
  if (current === "CANCELLED") return { status: "CANCELLED", totalSteps, doneSteps, failedSteps };
  if (doneSteps === totalSteps && totalSteps > 0) return { status: "DONE", totalSteps, doneSteps, failedSteps };
  const stillRunnable = runnableSteps(steps).length > 0 || steps.some((s) => s.status === "RUNNING");
  if (failedSteps > 0 && !stillRunnable) return { status: "FAILED", totalSteps, doneSteps, failedSteps };
  return { status: "RUNNING", totalSteps, doneSteps, failedSteps };
}

/** How many attempts a step gets before the job gives up on it. */
export const MAX_STEP_ATTEMPTS = 3;
/** A step locked longer than this was left by a process that died; it is reclaimed. */
export const STALE_LOCK_MS = 3 * 60 * 1000;
/** Steps a browser tick may run before answering (nginx cuts the request at 60 s). */
export const TICK_BUDGET_MS = 40 * 1000;

/** Progress line for the person watching. */
export function describeProgress(steps: readonly StepState[]): string {
  const pages = steps.filter((s) => pageOfStep(s.stepKey) !== null);
  const pagesDone = pages.filter((s) => s.status === "DONE").length;
  const inv = steps.find((s) => s.stepKey === INVENTORY_STEP);
  const classify = steps.find((s) => s.stepKey === CLASSIFY_STEP);
  const scale = steps.find((s) => s.stepKey === SCALE_STEP);
  if (!inv || inv.status === "PENDING" || inv.status === "RUNNING") return "Opening the document";
  if (pages.length && pagesDone < pages.length) return `Reading sheets ${pagesDone}/${pages.length}`;
  if (classify && classify.status !== "DONE") return "Indexing sheets";
  if (scale && scale.status !== "DONE") return "Reading scales";
  return "Done";
}
