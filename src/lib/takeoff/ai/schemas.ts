import { z } from "zod";

/**
 * What the model may answer, and nothing else. Every number the takeoff uses
 * is computed by code afterwards: the model names regions by polygon and
 * segment ids, drains by text id, and an assembly by quoting the lines that
 * say so. Point coordinates are {x, y} objects — the schema transformer
 * rejects tuples (found in the proof of concept).
 */
export const ROOF_ASSEMBLY_TYPES = [
  "TPO",
  "PVC",
  "MOD_BIT_SELF_ADHERED",
  "MOD_BIT_TORCH",
  "BUILT_UP",
  "LIQUID_APPLIED_COATING",
  "CEMENTITIOUS_WATERPROOFING",
  "STANDING_SEAM_METAL",
  "CONCRETE_TILE",
  "CLAY_TILE",
  "ASPHALT_SHINGLE",
  "OTHER",
] as const;
export type RoofAssemblyType = (typeof ROOF_ASSEMBLY_TYPES)[number];

export const ROOF_ASSEMBLY_LABEL: Record<RoofAssemblyType, string> = {
  TPO: "TPO membrane",
  PVC: "PVC membrane",
  MOD_BIT_SELF_ADHERED: "Modified bitumen, self-adhered",
  MOD_BIT_TORCH: "Modified bitumen, torch-applied",
  BUILT_UP: "Built-up roof",
  LIQUID_APPLIED_COATING: "Liquid-applied coating",
  CEMENTITIOUS_WATERPROOFING: "Cementitious waterproofing",
  STANDING_SEAM_METAL: "Standing-seam metal",
  CONCRETE_TILE: "Concrete tile",
  CLAY_TILE: "Clay tile",
  ASPHALT_SHINGLE: "Asphalt shingle",
  OTHER: "Other",
};

export const RoofSpecsSchema = z.object({
  assembly: z.union([
    z.null(),
    z.object({
      type: z.enum(ROOF_ASSEMBLY_TYPES),
      description: z.string(),
      sourceSheets: z.array(z.string()),
      sourceLineIds: z.array(z.string()),
    }),
  ]),
  deck: z.string().nullable(),
  insulation: z.string().nullable(),
  parapetDetail: z.string().nullable(),
  slopes: z.array(z.string()),
  drainage: z.string().nullable(),
  notSpecified: z.array(z.string()),
  evidence: z.string().max(400),
});
export type RoofSpecsOutput = z.infer<typeof RoofSpecsSchema>;

export const ROOF_REGION_KINDS = ["ROOF_FIELD", "CRICKET", "PARAPET_WALL", "BALCONY_OR_TERRACE", "EQUIPMENT_PAD", "NOT_ROOF"] as const;
export type RoofRegionKind = (typeof ROOF_REGION_KINDS)[number];

export const DRAIN_KINDS = ["PRIMARY", "EMERGENCY_OVERFLOW", "SCUPPER"] as const;
export type DrainKind = (typeof DRAIN_KINDS)[number];

const pointPx = z.object({ x: z.number(), y: z.number() });

export const RoofRegionsSchema = z.object({
  regions: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(ROOF_REGION_KINDS),
      polygonPx: z.array(pointPx).min(3),
      slopeText: z.string().nullable(),
      boundedBySegmentIds: z.array(z.string()),
      confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
      evidence: z.string().max(200),
    }),
  ),
  parapetSegmentIds: z.array(z.string()),
  drains: z.array(z.object({ textId: z.string(), kind: z.enum(DRAIN_KINDS), sizeText: z.string().nullable() })),
  cricketCount: z.number().int(),
  assemblyIdentifiedOnThisSheet: z.boolean(),
  notes: z.string().max(400),
});
export type RoofRegionsOutput = z.infer<typeof RoofRegionsSchema>;
