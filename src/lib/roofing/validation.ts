import { z } from "zod";
import { MEASUREMENT_KEYS, valueProblem, type MeasurementKey, type MeasurementValues } from "./measurements";

/** Measurement values typed by a person: only known fields, each checked by the same rule the screens show. */
export const measurementValuesSchema = z
  .record(z.string(), z.union([z.number(), z.string(), z.null()]))
  .superRefine((obj, ctx) => {
    for (const [key, value] of Object.entries(obj)) {
      if (!MEASUREMENT_KEYS.includes(key as MeasurementKey)) {
        ctx.addIssue({ code: "custom", path: [key], message: "Unknown measurement" });
        continue;
      }
      const problem = valueProblem(key as MeasurementKey, value);
      if (problem) ctx.addIssue({ code: "custom", path: [key], message: problem });
    }
  })
  .transform((obj) => obj as MeasurementValues);

export const createManualSchema = z.object({
  jobId: z.string().min(1).nullish(),
  label: z.string().trim().max(120).nullish(),
  source: z.enum(["MANUAL", "FIELD"]).default("MANUAL"),
  values: measurementValuesSchema,
});

export const updateMeasurementSchema = z.object({
  values: measurementValuesSchema.optional(),
  label: z.string().trim().max(120).nullable().optional(),
  reviewed: z.boolean().optional(),
});
