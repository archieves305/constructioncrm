import type { WorkflowRole } from "../../../../src/generated/prisma/client";
import type { ChecklistItemSpec, TaskSpec } from "../../../../src/lib/workflows/templates/types";

/**
 * Authoring shorthand for the streamlined ("slim") seed files. Its own copy,
 * not an import of v1's: v1 is frozen content pinned by hash, and a change
 * made here must never reach it.
 *
 * The slim generation uses fewer roles on purpose — Estimator, Purchasing
 * and Quality Control steps became project-manager steps or checklist lines,
 * because on most jobs nobody holds those roles and the steps were born
 * unassigned.
 */

export const PM: WorkflowRole = "PROJECT_MANAGER";
export const SUP: WorkflowRole = "SUPERINTENDENT";
export const PC: WorkflowRole = "PERMIT_COORDINATOR";
export const OA: WorkflowRole = "OFFICE_ADMIN";
export const ACC: WorkflowRole = "ACCOUNTING";
export const SR: WorkflowRole = "SALES_REP";
/** Code-violation cases only: resolves to the case's case manager. */
export const CM: WorkflowRole = "CASE_MANAGER";

/** Phase bands for a violation case; unchanged from v1 so the nine phases keep their order. */
export const VIOLATION_BANDS = {
  INTAKE: 100,
  SITE_INVESTIGATION: 200,
  STRATEGY: 300,
  PERMITTING: 400,
  CORRECTIVE_CONSTRUCTION: 500,
  AGENCY_COMPLIANCE: 600,
  HEARINGS_FINES_LIENS: 700,
  CLOSURE: 800,
} as const;

type Extra = Omit<TaskSpec, "key" | "title" | "role">;

/** A step. `days` is the business-day offset from the anchor. */
export function task(key: string, title: string, role: WorkflowRole, days: number, extra: Extra = {}): TaskSpec {
  return { key, title, role, dueOffsetBusinessDays: days, ...extra };
}

export const REQ = { permit: "REQUIRED" as const };
export const any = (...keys: string[]) => ({ anyOf: keys });

/** A checklist line that only appears when one of the toggles is on. */
export const when = (toggles: string | string[], text: string): ChecklistItemSpec => ({
  text,
  condition: { anyOf: Array.isArray(toggles) ? toggles : [toggles] },
});

/**
 * The no-permit branch, two steps: record who confirmed it, then the
 * project manager's approval. Lives once per job (in Core) and once per
 * case; the phase that holds it carries the legal warning.
 */
export const NO_PERMIT_TASKS = (after: string): TaskSpec[] => [
  task("verify_no_permit_required", "Verify and record that no permit is required", PC, 1, {
    dependsOn: [after],
    priority: "HIGH",
    checklist: [
      "Confirming person and title / department",
      "Jurisdiction",
      "Date and method (phone, email, portal)",
      "Supporting document attached, or none available",
    ],
  }),
  task("obtain_pm_approval_no_permit", "Project-manager approval to proceed without a permit", PM, 1, {
    dependsOn: ["^"],
    blocking: true,
    priority: "HIGH",
  }),
];
