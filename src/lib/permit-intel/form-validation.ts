import { z } from "zod";

/** Request bodies of the form-template and form-fill routes. Client-safe; the PATCH schemas carry no defaults. */
const id = z.string().min(1).max(60);

export const templateMetaSchema = z.object({
  name: z.string().trim().min(2, "Name the form").max(200),
  jurisdictionId: id.nullable().optional(),
  county: z.string().trim().max(80).nullable().optional(),
  permitTypeKeys: z.array(z.string().max(60)).max(20).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
export const templateMetaPatchSchema = templateMetaSchema.partial();

export const fieldMapsSchema = z.object({
  fields: z
    .array(
      z.object({
        fieldName: z.string().min(1).max(300),
        dataKey: z.string().trim().max(300).nullable(),
        transform: z.string().trim().max(300).nullable(),
      }),
    )
    .min(1)
    .max(1000),
});

export const fillCreateSchema = z.object({ templateId: id });
export const fillOverrideSchema = z.object({ field: z.string().min(1).max(300), value: z.string().max(4000).nullable() });
