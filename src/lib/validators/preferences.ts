import { z } from "zod";

/** PATCH /api/me/preferences — every key optional; an absent key means "leave alone". */
export const preferencesSchema = z.object({
  taskEmailsEnabled: z.boolean().optional(),
  escalationEmailsEnabled: z.boolean().optional(),
  reminderDigestEnabled: z.boolean().optional(),
  nudgeEmailsEnabled: z.boolean().optional(),
  defaultListScope: z.enum(["MINE", "ALL"]).optional(),
  boardDensity: z.enum(["COMFORTABLE", "COMPACT"]).optional(),
});

export type PreferencesPatch = z.infer<typeof preferencesSchema>;
