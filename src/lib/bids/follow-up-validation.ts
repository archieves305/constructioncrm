import { z } from "zod";

/** Bodies for the follow-up routes (PlanHub plan §6). PATCH-style: no defaults. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as yyyy-MM-dd");

export const followUpActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("call"), contactId: z.string().min(1).nullish(), outcome: z.enum(["SPOKE", "LEFT_MESSAGE", "NO_ANSWER"]), summary: z.string().trim().min(1, "say what happened").max(5000), nextDay: day.nullish() }),
  z.object({ type: z.literal("reply"), contactId: z.string().min(1).nullish(), summary: z.string().trim().min(1, "say what they wrote").max(10000), nextDay: day.nullish() }),
  z.object({ type: z.literal("set_date"), day }),
  z.object({ type: z.literal("clear_date") }),
  z.object({ type: z.literal("pause"), until: day, scope: z.enum(["email", "all"]), reason: z.string().trim().min(3, "say why").max(500) }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("set_anchor"), day: day.nullable() }),
]);

export const draftPatchSchema = z.object({
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().min(1).max(20000).optional(),
  toEmails: z.array(z.string().trim().min(3).max(320)).min(1).max(10).optional(),
});

export const draftActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("mark_sent") }),
  z.object({ action: z.literal("discard"), reason: z.string().trim().max(500).default("") }),
]);
