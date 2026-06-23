import { z } from "zod";

// Keep in sync with the EstimateUnitType / EstimateTemplateCategory / EstimateStatus
// Prisma enums. Listed explicitly so the API validates request bodies without a
// runtime dependency on the generated client.
export const ESTIMATE_UNIT_TYPES = [
  "EACH",
  "OPENING",
  "SHEET",
  "SQ_FT",
  "LINEAR_FT",
  "ROOM",
  "LUMP_SUM",
  "LABOR_HOUR",
] as const;

export const ESTIMATE_TEMPLATE_CATEGORIES = [
  "ROOFING",
  "DRYWALL",
  "INTERIOR_RENOVATION",
  "WINDOWS_DOORS",
] as const;

export const ESTIMATE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "DECLINED",
] as const;

const money = z
  .number({ message: "must be a number" })
  .nonnegative("must be ≥ 0")
  .max(10_000_000, "too large")
  .default(0);

const percent = z
  .number({ message: "must be a number" })
  .min(0, "must be ≥ 0")
  .max(100, "must be ≤ 100")
  .default(0);

export const genericLineItemSchema = z.object({
  description: z.string().trim().min(1, "Description required").max(300),
  unitType: z.enum(ESTIMATE_UNIT_TYPES),
  quantity: money,
  unitPrice: money,
  isOptional: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullish(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const genericSectionSchema = z.object({
  title: z.string().trim().min(1, "Section title required").max(200),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  items: z.array(genericLineItemSchema).max(200).default([]),
});

export const genericEstimateInputSchema = z.object({
  templateCategory: z.enum(ESTIMATE_TEMPLATE_CATEGORIES),
  templateId: z.string().nullish(),
  name: z.string().trim().min(1, "Estimate name required").max(200),
  status: z.enum(ESTIMATE_STATUSES).default("DRAFT"),
  sections: z.array(genericSectionSchema).min(1, "Add at least one section"),
  marginPercent: z
    .number({ message: "margin must be a number" })
    .min(0, "margin must be ≥ 0")
    .max(99.999, "margin must be < 100")
    .default(0),
  discountEnabled: z.boolean().default(false),
  discountPercent: percent,
  salesTaxPercent: percent,
  validityDays: z
    .number({ message: "validity must be a number" })
    .int()
    .min(1)
    .max(365)
    .default(30),
  notes: z.string().trim().max(5000).nullish(),
  exclusions: z.string().trim().max(5000).nullish(),
});

export type GenericEstimateInputDto = z.infer<typeof genericEstimateInputSchema>;

export const genericEstimatePdfKindSchema = z.object({
  kind: z.enum(["client", "internal"]),
});
