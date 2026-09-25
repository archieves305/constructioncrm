import { z } from "zod";

const key = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits and underscores").max(60);

export const paymentScheduleItemSchema = z.object({
  key,
  label: z.string().trim().min(1).max(80),
  percent: z.number().min(0).max(100),
  trigger: z.string().trim().max(300).default(""),
});

export const contractArticleSchema = z.object({
  key,
  title: z.string().trim().max(200),
  body: z.string().max(20_000),
});

export const contractTemplateContentSchema = z.object({
  title: z.string().trim().max(200),
  articles: z.array(contractArticleSchema).max(60),
  paymentSchedule: z.object({ items: z.array(paymentScheduleItemSchema).max(12) }),
  paymentScheduleText: z.string().max(2000).default(""),
  consentText: z.string().max(4000).default(""),
});

export const createContractTemplateSchema = z.object({
  key,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
});

export const updateContractTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
});

export const createDraftVersionSchema = z.object({
  fromVersionId: z.string().nullish(),
});

export const publishVersionSchema = z.object({
  changeNotes: z.string().trim().max(2000).nullish(),
});

export const createContractSchema = z
  .object({
    estimateId: z.string().min(1).optional(),
    roofEstimateId: z.string().min(1).optional(),
    includeOptionalItemIds: z.array(z.string().min(1)).max(500).default([]),
    templateKey: z.string().trim().min(1).max(60).nullish(),
    paymentSchedule: z.array(paymentScheduleItemSchema).max(12).nullish(),
  })
  .refine((v) => (v.estimateId ? 1 : 0) + (v.roofEstimateId ? 1 : 0) === 1, {
    message: "Provide exactly one of estimateId or roofEstimateId",
    path: ["estimateId"],
  });

export const regenerateContractSchema = z.object({
  includeOptionalItemIds: z.array(z.string().min(1)).max(500).optional(),
  templateKey: z.string().trim().min(1).max(60).nullish(),
  paymentSchedule: z.array(paymentScheduleItemSchema).max(12).nullish(),
});

export const voidContractSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const sendContractSchema = z.object({
  to: z.string().trim().email().max(320).optional(),
  message: z.string().trim().max(2000).nullish(),
});

export const signContractSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).nullish(),
  signaturePngDataUri: z
    .string()
    .startsWith("data:image/png;base64,", "Signature must be a PNG")
    .max(1_000_000, "Signature image is too large"),
  consent: z.literal(true, { message: "Consent is required" }),
  consentText: z.string().max(4000).optional(),
});

export const declineContractSchema = z.object({
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(4000).nullish(),
});
