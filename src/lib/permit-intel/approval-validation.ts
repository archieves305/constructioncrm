import { z } from "zod";
import { AUTHORITIES, CATEGORIES } from "./approvals-plan";

/** Request bodies of the product-approval routes. Client-safe; the PATCH schemas carry no defaults. */
const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const day = z.coerce.date().nullable();
const psf = z.number().min(-500).max(500).nullable();

export const approvalPatchSchema = z
  .object({
    authority: z.enum(AUTHORITIES),
    approvalNumber: text(60),
    revision: text(20),
    manufacturer: text(200),
    productName: text(200),
    models: z.array(z.string().trim().min(1).max(120)).max(50),
    category: z.enum(CATEGORIES),
    hvhzApproved: z.boolean().nullable(),
    nonHvhzApproved: z.boolean().nullable(),
    designPressurePos: psf,
    designPressureNeg: psf,
    impactRated: z.boolean().nullable(),
    limitations: text(6000),
    issuedAt: day,
    expiresAt: day,
    notes: text(4000),
    isActive: z.boolean(),
  })
  .partial();
export type ApprovalPatch = z.infer<typeof approvalPatchSchema>;

export const materialsSchema = z.object({ itemIds: z.array(z.string().min(1).max(60)).max(100) });

const productFields = z.object({
  usedAs: z.string().trim().max(120),
  requiredPressurePos: z.number().min(0).max(500).nullable(),
  requiredPressureNeg: z.number().min(-500).max(500).nullable(),
  notes: text(2000),
});
export const permitProductSchema = productFields.partial().extend({ approvalId: z.string().min(1).max(60) });
export const permitProductPatchSchema = productFields.partial();
