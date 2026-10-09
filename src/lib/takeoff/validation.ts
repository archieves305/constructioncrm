import { z } from "zod";
import { DISCIPLINES } from "./types";

const trimmed = (max: number) => z.string().trim().max(max);

export const createPlanSetSchema = z.object({
  leadId: z.string().min(1),
  jobId: z.string().min(1).nullish(),
  name: trimmed(120).min(1).default("Plan set"),
});

export const patchPlanSetSchema = z
  .object({
    name: trimmed(120).min(1).optional(),
    notes: trimmed(2000).nullable().optional(),
    jobId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const DOCUMENT_KINDS = ["FULL_SET", "PARTIAL", "ADDENDUM", "REVISION"] as const;

export const documentFieldsSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS).default("FULL_SET"),
  label: trimmed(120).min(1).default("Plan set"),
  revisionLabel: trimmed(40).nullable().optional(),
});

export const patchSheetSchema = z
  .object({
    sheetNumber: trimmed(20).nullable().optional(),
    title: trimmed(160).nullable().optional(),
    discipline: z.enum(DISCIPLINES as [string, ...string[]]).optional(),
    scaleText: trimmed(40).nullable().optional(),
    revisionLabel: trimmed(40).nullable().optional(),
    supersededBySheetId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export type PatchSheetInput = z.infer<typeof patchSheetSchema>;

// ── Takeoffs and measurements (M2) ──

export const TRADES = ["ROOFING", "PLUMBING"] as const;
export const MEASUREMENT_KINDS = ["AREA", "LENGTH", "COUNT"] as const;
export const REVIEW_STATUSES = ["AI_GENERATED", "REVIEWED", "MODIFIED", "APPROVED", "EXCLUDED", "NEEDS_CLARIFICATION"] as const;
export const SHEET_ROLES = ["roof_plan", "roof_details", "floor_plan", "dwv_plan", "water_plan", "riser", "schedule", "gas_plan", "notes", "site"] as const;

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
export const geometrySchema = z.object({ points: z.array(point).min(1).max(2000) });

export const createTakeoffSchema = z.object({
  planSetId: z.string().min(1),
  trade: z.enum(TRADES),
});

export const patchTakeoffSchema = z
  .object({
    status: z.enum(["DRAFT", "IN_REVIEW", "READY"]).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const setTakeoffSheetsSchema = z.object({
  sheets: z.array(z.object({ planSheetId: z.string().min(1), role: z.enum(SHEET_ROLES).nullable().optional() })).max(200),
});

const attributes = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const createMeasurementSchema = z.object({
  planSheetId: z.string().min(1),
  kind: z.enum(MEASUREMENT_KINDS),
  metricKey: trimmed(60).min(1),
  label: trimmed(160).min(1),
  attributes: attributes.optional(),
  geometry: geometrySchema,
});

export const patchMeasurementSchema = z
  .object({
    label: trimmed(160).min(1).optional(),
    metricKey: trimmed(60).min(1).optional(),
    attributes: attributes.nullable().optional(),
    geometry: geometrySchema.optional(),
    reviewStatus: z.enum(REVIEW_STATUSES).optional(),
    note: trimmed(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const calibrateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("confirm") }),
  z.object({ mode: z.literal("manual"), a: point, b: point, distanceFt: z.number().positive().max(5000) }),
  z.object({ mode: z.literal("clear") }),
]);

export type CreateMeasurementInput = z.infer<typeof createMeasurementSchema>;
export type PatchMeasurementInput = z.infer<typeof patchMeasurementSchema>;
export type CalibrateInput = z.infer<typeof calibrateSchema>;
