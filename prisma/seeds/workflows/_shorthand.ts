import type { WorkflowRole } from "../../../src/generated/prisma/client";
import type { TaskSpec } from "../../../src/lib/workflows/templates/types";

/**
 * Authoring shorthand for the seed files. Each template file reads as a
 * table: key, title, role, then the differences from the defaults.
 */

export const PM: WorkflowRole = "PROJECT_MANAGER";
export const SUP: WorkflowRole = "SUPERINTENDENT";
export const PC: WorkflowRole = "PERMIT_COORDINATOR";
export const EST: WorkflowRole = "ESTIMATOR";
export const OA: WorkflowRole = "OFFICE_ADMIN";
export const PUR: WorkflowRole = "PURCHASING";
export const ACC: WorkflowRole = "ACCOUNTING";
export const SR: WorkflowRole = "SALES_REP";
export const QC: WorkflowRole = "QUALITY_CONTROL";
/** Code-violation cases only: resolves to the case's case manager. */
export const CM: WorkflowRole = "CASE_MANAGER";

/**
 * Phase bands for a violation case. A case composes alone (no Core), so
 * these only need to order its own phases; PERMITTING reuses the shared band
 * so the legal no-permit phase sits where it does on a job.
 */
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

/** A task. `days` is the business-day offset from the anchor (default 2). */
export function task(key: string, title: string, role: WorkflowRole, days: number, extra: Extra = {}): TaskSpec {
  return { key, title, role, dueOffsetBusinessDays: days, ...extra };
}

export const REQ = { permit: "REQUIRED" as const };
export const NOT = { permit: "NOT_REQUIRED" as const };
export const any = (...keys: string[]) => ({ anyOf: keys });
export const all = (...keys: string[]) => ({ allOf: keys });

/** A checklist line that only appears when a toggle is on. */
export const when = (toggle: string, text: string) => ({ text, condition: { anyOf: [toggle] } });

export const NO_PERMIT_TASKS = (firstTitle: string): TaskSpec[] => [
  task("verify_no_permit_required", firstTitle, PC, 1, { priority: "HIGH", requiredEvidence: "ATTACHMENT" }),
  task("record_no_permit_confirmation", "Record confirming person, jurisdiction and confirmation date", PC, 0, {
    dependsOn: ["^"],
    checklist: ["Confirming person", "Title / department", "Jurisdiction", "Date confirmed", "Method (phone, email, portal)"],
  }),
  task("upload_no_permit_support", "Upload supporting documentation, if available", PC, 1, { dependsOn: ["^"] }),
  task("obtain_pm_approval_no_permit", "Obtain project-manager approval to proceed without a permit", PM, 1, {
    dependsOn: ["^"],
    blocking: true,
    priority: "HIGH",
  }),
];
