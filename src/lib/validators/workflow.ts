import { z } from "zod/v4";

/** Mirrors the WorkflowRole enum — hand-written, as the repo's validators are. */
export const WORKFLOW_ROLE_VALUES = [
  "PROJECT_MANAGER",
  "SALES_REP",
  "SUPERINTENDENT",
  "PERMIT_COORDINATOR",
  "ESTIMATOR",
  "OFFICE_ADMIN",
  "PURCHASING",
  "ACCOUNTING",
  "QUALITY_CONTROL",
] as const;

const roleEnum = z.enum(WORKFLOW_ROLE_VALUES);
const key = z.string().regex(/^[a-z][a-z0-9_]*$/, "invalid key");

/** { roofing: { tear_off: true } } */
const scopeToggles = z.record(key, z.record(key, z.boolean()));
const team = z.partialRecord(roleEnum, z.string().min(1).nullable());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "expected yyyy-MM-dd");

export const applyWorkflowSchema = z.object({
  templateKeys: z.array(key).max(10).default([]),
  permitStatus: z.enum(["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"]),
  scopeToggles: scopeToggles.default({}),
  team: team.optional(),
  targetStartDate: dateOnly.nullable().optional(),
  jurisdiction: z.string().trim().max(200).nullable().optional(),
  permit: z
    .object({
      notes: z.string().trim().max(4000).nullable().optional(),
      documentFileId: z.string().min(1).nullable().optional(),
    })
    .optional(),
});

export const patchWorkflowSchema = z
  .object({
    team: team.optional(),
    permit: z
      .object({
        status: z.enum(["REQUIRED", "NOT_REQUIRED"]),
        notes: z.string().trim().max(4000).nullable().optional(),
        documentFileId: z.string().min(1).nullable().optional(),
        jurisdiction: z.string().trim().max(200).nullable().optional(),
      })
      .optional(),
    scopeToggles: scopeToggles.optional(),
  })
  .refine((v) => v.team !== undefined || v.permit !== undefined || v.scopeToggles !== undefined, {
    message: "Nothing to change",
  });

export const manualWorkflowTaskSchema = z.object({
  phaseKey: z.string().min(1),
  title: z.string().trim().min(1, "Task title is required").max(300),
  description: z.string().trim().max(10_000).optional(),
  assignedUserId: z.string().min(1).nullable().optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dependsOnTaskIds: z.array(z.string().min(1)).max(20).optional(),
});

export const roleDefaultsSchema = z.object({
  defaults: z.partialRecord(roleEnum, z.string().min(1).nullable()),
});

export type ApplyWorkflowBody = z.infer<typeof applyWorkflowSchema>;
export type PatchWorkflowBody = z.infer<typeof patchWorkflowSchema>;
export type ManualWorkflowTaskBody = z.infer<typeof manualWorkflowTaskSchema>;
