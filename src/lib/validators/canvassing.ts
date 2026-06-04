import { z } from "zod";
import { scoringConfigSchema } from "@/lib/services/canvassing/scoring-config";

// Find Properties search around a GPS point (mirrors the Zylow nearby query).
export const propertySearchQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_miles: z.coerce.number().min(0).max(50).default(5),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// Admin → Canvassing settings (PUT body). The full per-rule scoring config is
// validated by scoringConfigSchema.
export const canvassingSettingsSchema = z.object({
  scoringConfig: scoringConfigSchema,
  minPriorityScore: z.coerce.number().int().min(0).max(100),
  showAbsenteeOwners: z.boolean(),
  hideLowScoreProperties: z.boolean(),
  cacheTtlDays: z.coerce.number().int().min(1).max(365),
  defaultOpeningScript: z.string().trim().min(1),
  complianceDisclaimer: z.string().trim().min(1),
});

export type PropertySearchQuery = z.infer<typeof propertySearchQuerySchema>;
export type CanvassingSettingsInput = z.infer<typeof canvassingSettingsSchema>;
