import { z } from "zod";

export const ROOF_MATERIALS = ["SHINGLE", "TILE", "METAL", "FLAT"] as const;

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

export const roofTypeLineSchema = z.object({
  material: z.enum(ROOF_MATERIALS),
  squares: z
    .number({ message: "squares must be a number" })
    .positive("squares must be > 0")
    .max(10_000, "squares too large"),
  laborRatePerSquare: z
    .number({ message: "labor rate must be a number" })
    .nonnegative("labor rate must be ≥ 0")
    .max(100_000, "labor rate too large"),
});

export const estimateInputSchema = z.object({
  roofTypes: z
    .array(roofTypeLineSchema)
    .min(1, "Add at least one roof type"),
  materialCost: money,
  materialSelection: z.string().trim().max(500).nullish(),
  permitFee: money,
  dumpsterFee: money,
  tearOffFee: money,
  deckingFee: money,
  underlaymentFee: money,
  flashingVentFee: money,
  skylightChimneyFee: money,
  guttersFee: money,
  miscLabel: z.string().trim().max(120).nullish(),
  miscFee: money,
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
  specialTerms: z.string().trim().max(5000).nullish(),
  // Customer-facing proposal fields
  existingRoofType: z.string().trim().max(200).nullish(),
  proposedRoofTypeOverride: z.string().trim().max(200).nullish(),
  underlaymentType: z.string().trim().max(500).nullish(),
  permitIncluded: z.boolean().default(true),
  projectDurationText: z.string().trim().max(120).nullish(),
  plywoodSheetsIncluded: z
    .number({ message: "plywood sheets must be a number" })
    .int()
    .min(0)
    .max(500)
    .nullish(),
  additionalPlywoodPrice: z
    .number({ message: "plywood price must be a number" })
    .nonnegative()
    .max(10_000)
    .nullish(),
  workmanshipWarrantyYears: z
    .number({ message: "warranty years must be a number" })
    .int()
    .min(0)
    .max(99)
    .nullish(),
  manufacturerWarranty: z.string().trim().max(500).nullish(),
  isEstimateOnly: z.boolean().default(false),
});

export type EstimateInputDto = z.infer<typeof estimateInputSchema>;

export const estimatePdfKindSchema = z.object({
  kind: z.enum(["client", "internal"]),
});
