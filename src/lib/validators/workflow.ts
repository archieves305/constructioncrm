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

// ── Stage 2: reconciliation, inspections, dependencies, template editing ──

export const reconcileChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("permit"),
    status: z.enum(["REQUIRED", "NOT_REQUIRED"]),
    reason: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    documentFileId: z.string().min(1).nullable().optional(),
    jurisdiction: z.string().trim().max(200).nullable().optional(),
  }),
  z.object({ kind: z.literal("add-module"), templateKeys: z.array(key).min(1).max(10), scopeToggles: scopeToggles.optional() }),
  z.object({ kind: z.literal("remove-module"), templateKey: key, reason: z.string().trim().min(1, "Say why").max(2000), retainTaskIds: z.array(z.string().min(1)).max(500).optional() }),
  z.object({ kind: z.literal("scope"), scopeToggles }),
  z.object({ kind: z.literal("upgrade-module"), templateKey: key, versionId: z.string().min(1).optional() }),
]);

export const inspectionResultSchema = z.object({
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  notes: z.string().trim().max(4000).nullable().optional(),
  inspectedAt: dateOnly.optional(),
  jobPermitInspectionId: z.string().min(1).nullable().optional(),
});

export const taskDependencySchema = z.object({
  dependsOnTaskId: z.string().min(1),
  kind: z.enum(["BLOCKING", "DATE_ONLY"]).default("BLOCKING"),
});

const permitCondition = z.enum(["REQUIRED", "NOT_REQUIRED"]).nullable();
const evidence = z.enum(["ATTACHMENT", "PHOTO", "PERMIT_NUMBER", "PERMIT_DETERMINATION", "INSPECTION_RESULT", "PAYMENT_STATUS", "NOTE"]).nullable();
const condition = z.object({ anyOf: z.array(key).max(20).optional(), allOf: z.array(key).max(20).optional() }).nullable();

export const templateMetaSchema = z.object({
  key: key.optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["CORE", "TRADE"]).default("TRADE"),
  trade: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  serviceCategoryIds: z.array(z.string().min(1)).max(50).optional(),
});

export const templateMetaPatchSchema = templateMetaSchema.omit({ key: true, kind: true }).partial();

export const duplicateTemplateSchema = z.object({ key, name: z.string().trim().min(1).max(120) });

export const versionPatchSchema = z.object({
  changeNotes: z.string().trim().max(4000).nullable().optional(),
  scopeToggles: z.array(z.object({ key, label: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional(), default: z.boolean() })).max(40).optional(),
});

export const phaseInputSchema = z.object({
  key: key.optional(),
  name: z.string().trim().min(1).max(120),
  band: z.number().int().min(1).max(10_000),
  description: z.string().trim().max(2000).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  conditionPermit: permitCondition.optional(),
});
export const phasePatchSchema = phaseInputSchema.partial();

export const taskTemplateInputSchema = z.object({
  phaseId: z.string().min(1),
  key: key.optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  role: roleEnum,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  anchor: z.enum(["JOB_CREATED", "APPLIED_AT", "TARGET_START", "PHASE_START", "PREDECESSOR"]).optional(),
  dueOffsetBusinessDays: z.number().int().min(-60).max(365).optional(),
  durationBusinessDays: z.number().int().min(0).max(365).nullable().optional(),
  autoActivate: z.boolean().optional(),
  blocking: z.boolean().optional(),
  requiredEvidence: evidence.optional(),
  requiredEvidenceParam: z.string().trim().max(60).nullable().optional(),
  checklist: z.array(z.object({ label: z.string().trim().min(1).max(300), condition: condition.optional() })).max(40).optional(),
  conditionPermit: permitCondition.optional(),
  conditionAnyOf: z.array(key).max(20).optional(),
  conditionAllOf: z.array(key).max(20).optional(),
  overridesCoreKey: key.nullable().optional(),
  dependsOn: z.array(z.object({ ref: z.string().regex(/^(core:)?[a-z][a-z0-9_]*$/), kind: z.enum(["BLOCKING", "DATE_ONLY"]).optional() })).max(30).optional(),
});
export const taskTemplatePatchSchema = taskTemplateInputSchema.partial();

export const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500), phaseId: z.string().min(1).optional() });

export type ReconcileChangeBody = z.infer<typeof reconcileChangeSchema>;
