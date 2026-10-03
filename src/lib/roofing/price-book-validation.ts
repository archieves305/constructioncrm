import { z } from "zod";
import { ROOF_TYPES } from "./types";

const roofType = z.enum(ROOF_TYPES as unknown as [string, ...string[]]).nullable();
const money = z.number().finite().min(0).max(1_000_000);

export const createMaterialSchema = z.object({
  category: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(80).nullish(),
  roofType: roofType.optional(),
  unitType: z.string().trim().min(1).max(30),
  vendorId: z.string().min(1).nullish(),
  isPreferred: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullish(),
  unitCost: money.nullish(),
});

export const updateMaterialSchema = createMaterialSchema.omit({ unitCost: true }).partial().extend({ isActive: z.boolean().optional() });

export const addPriceSchema = z.object({
  unitCost: money,
  // A bare day (yyyy-MM-dd); defaults to today.
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(300).nullish(),
});

export const setRuleSchema = z.object({
  value: z.number().finite(),
  active: z.boolean(),
  note: z.string().trim().max(300).nullish(),
});

export const takeoffPreviewSchema = z.object({
  measurementId: z.string().min(1),
  roofType: z.enum(ROOF_TYPES as unknown as [string, ...string[]]),
  wastePct: z.number().min(0).max(0.5).optional(),
  battenInstall: z.boolean().optional(),
});
