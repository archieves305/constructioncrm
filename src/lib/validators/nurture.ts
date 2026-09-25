import { z } from "zod";

const dayList = z
  .array(z.number().int().min(1).max(365))
  .max(12)
  .refine((d) => d.every((v, i) => i === 0 || v > d[i - 1]!), { message: "Days must be increasing and unique" });

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const nurtureSettingsSchema = z
  .object({
    enabled: z.boolean(),
    followUpDays: dayList.min(1, "At least one follow-up day"),
    followUpEveryDaysAfter: z.number().int().min(7).max(365),
    nurtureDays: dayList,
    nurtureEveryDaysAfter: z.number().int().min(7).max(365),
    nurtureMonthlyOffsetDays: z.number().int().min(1).max(180),
    minGapHours: z.number().int().min(0).max(24 * 14),
    sendWindowStartHour: z.number().int().min(0).max(23),
    sendWindowEndHour: z.number().int().min(1).max(24),
    timeZone: z.string().refine(isValidTimeZone, "Not a valid IANA time zone"),
    weekdaysOnly: z.boolean(),
    personalTouchSkipDays: z.number().int().min(0).max(60),
    repPromptAfterDays: z.number().int().min(1).max(180),
    excludedStageIds: z.array(z.string().min(1)).max(50),
  })
  .refine((v) => v.sendWindowStartHour < v.sendWindowEndHour, { message: "The window must end after it starts", path: ["sendWindowEndHour"] });

export type NurtureSettingsInput = z.infer<typeof nurtureSettingsSchema>;

export const nurtureContentSchema = z
  .object({
    kind: z.enum(["FOLLOW_UP", "NURTURE"]),
    step: z.number().int().min(1).max(50).nullish(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(20_000),
    category: z.string().trim().max(60).nullish(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.kind !== "FOLLOW_UP" || (v.step != null && v.step >= 1), { message: "Follow-up pieces need a step number", path: ["step"] });

export const nurtureContentReorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export const nurturePreviewSchema = z.object({ subject: z.string().max(200).optional(), body: z.string().max(20_000).optional() });

export const leadNurtureActionSchema = z.object({
  action: z.enum(["pause", "resume", "stop", "enrol", "touch"]),
  communicationType: z.enum(["CALL", "SMS", "EMAIL"]).optional(),
  note: z.string().trim().max(4000).optional(),
});
