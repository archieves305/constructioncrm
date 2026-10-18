import { z } from "zod";
import { CORRECTION_CATEGORIES, CORRECTION_STATUSES, CORRECTION_TARGETS, RESPONSIBLE_PARTIES } from "./corrections-plan";

/**
 * Request bodies of the corrections and message routes. Client-safe. The
 * PATCH schemas carry no defaults (zod's partial() keeps a default, which
 * would reset every field a PATCH did not send).
 */
const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();
const day = z.coerce.date();
const id = z.string().min(1).max(60);

export const noticeCreateSchema = z
  .object({
    source: z.enum(["UPLOAD", "PASTE"]),
    // UPLOAD: the letter, already uploaded to the permit
    fileId: id.optional(),
    // PASTE: the text as received
    text: z.string().max(200_000).optional(),
    receivedAt: day.optional(),
    reviewerName: optText(200),
  })
  .refine((v) => (v.source === "UPLOAD" ? !!v.fileId : !!v.text?.trim()), { message: "Upload the notice or paste its text", path: ["text"] });
export type NoticeCreateInput = z.infer<typeof noticeCreateSchema>;

export const noticePatchSchema = z.object({
  receivedAt: day.optional(),
  reviewerName: optText(200),
  responseDueAt: day.nullable().optional(),
});

const itemFields = z.object({
  reviewerItemNumber: optText(40),
  reviewerDiscipline: optText(60),
  text: z.string().trim().min(1, "Write the comment").max(8000),
  sourcePage: z.number().int().min(1).max(2000).nullable().optional(),
  category: z.enum(CORRECTION_CATEGORIES),
  affects: z.enum(CORRECTION_TARGETS),
  affectsRef: optText(120),
  responsibleParty: z.enum(RESPONSIBLE_PARTIES),
  partyId: id.nullable().optional(),
  response: optText(8000),
  dueAt: day.nullable().optional(),
  previousItemId: id.nullable().optional(),
});
export const itemCreateSchema = itemFields.extend({
  category: itemFields.shape.category.default("OTHER"),
  affects: itemFields.shape.affects.default("OTHER"),
  responsibleParty: itemFields.shape.responsibleParty.default("KNU"),
});
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export const itemPatchSchema = itemFields.partial().extend({ status: z.enum(CORRECTION_STATUSES).optional() });
export type ItemPatchInput = z.infer<typeof itemPatchSchema>;

export const itemFileSchema = z.object({ fileId: id });

const emails = z.array(z.string().trim().toLowerCase().email("One of the addresses does not look right").max(200)).max(20);

export const messageCreateSchema = z.object({
  partyId: id.nullable().optional(),
  correctionItemIds: z.array(id).max(100).optional(),
  purpose: z.enum(["correction_request", "resubmission_notice", "status_inquiry", "other"]).optional(),
  // true: the AI writes the first draft (from the items and the party)
  ai: z.boolean().optional(),
  toEmails: emails.optional(),
  ccEmails: emails.optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().max(50_000).optional(),
});
export type MessageCreateInput = z.infer<typeof messageCreateSchema>;

export const messagePatchSchema = z.object({
  toEmails: emails.optional(),
  ccEmails: emails.optional(),
  subject: z.string().trim().min(1, "Give the email a subject").max(300).optional(),
  body: z.string().trim().min(1, "Write the email").max(50_000).optional(),
  attachmentFileIds: z.array(id).max(20).optional(),
  correctionItemIds: z.array(id).max(100).optional(),
});
export type MessagePatchInput = z.infer<typeof messagePatchSchema>;
