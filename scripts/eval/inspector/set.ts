import { z } from "zod";

/**
 * The evaluation set on disk (`set.json` beside a `photos/` folder). The set
 * holds real job photos, so it lives OUTSIDE the repository and never goes to
 * git or to any server but the model's.
 */
const box = z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });
const severity = z.enum(["CRITICAL", "MAJOR", "MINOR", "COSMETIC"]);

export const itemSchema = z.object({
  photo: z.string(),
  also: z.array(z.string()).default([]),
  title: z.string(),
  severity,
  trade: z.string(),
  box: box.nullable(),
});

export const caseSchema = z.object({
  id: z.string(),
  inspection: z.string(),
  kind: z.string(),
  profile: z.string(),
  area: z.string(),
  trade: z.string().nullable(),
  scopeText: z.string().nullable(),
  otherAreas: z.array(z.string()),
  photos: z.array(z.object({ key: z.string(), file: z.string(), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), width: z.number().int(), height: z.number().int() })),
  truth: z.array(itemSchema.extend({ source: z.enum(["AI", "PERSON"]) })),
  dismissed: z.array(itemSchema.extend({ reason: z.string().nullable() })),
  /** Confirmed findings with no photo: left out of the scoring, counted here. */
  unplaced: z.number().int(),
});

export const setSchema = z.object({
  name: z.string(),
  exportedAt: z.string(),
  source: z.string(),
  cases: z.array(caseSchema),
});

export type EvalCase = z.infer<typeof caseSchema>;
export type EvalSet = z.infer<typeof setSchema>;
