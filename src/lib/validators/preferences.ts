import { z } from "zod";
import type { NotificationCategory, NotificationEmailMode } from "@/generated/prisma/client";

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

/**
 * The legacy switches → notifications-v2 preferences, as the migration's
 * backfill did it: the master switch off = in-app only (and back on =
 * digest); each sub-switch off mutes its category. Pure.
 */
export function mirrorLegacyPrefs(
  d: PreferencesPatch,
  current: { notificationEmailMode: NotificationEmailMode; mutedCategories: NotificationCategory[] } | null,
): { notificationEmailMode?: NotificationEmailMode; mutedCategories?: NotificationCategory[] } {
  const out: { notificationEmailMode?: NotificationEmailMode; mutedCategories?: NotificationCategory[] } = {};
  if (d.taskEmailsEnabled !== undefined) {
    const mode = current?.notificationEmailMode ?? "DIGEST";
    if (!d.taskEmailsEnabled) out.notificationEmailMode = "IN_APP_ONLY";
    else if (mode === "IN_APP_ONLY") out.notificationEmailMode = "DIGEST";
  }
  const pairs: [boolean | undefined, NotificationCategory][] = [
    [d.reminderDigestEnabled, "REMINDERS"],
    [d.escalationEmailsEnabled, "ESCALATIONS"],
    [d.nudgeEmailsEnabled, "MENTIONS"],
  ];
  let muted = current?.mutedCategories ?? [];
  let touched = false;
  for (const [enabled, category] of pairs) {
    if (enabled === undefined) continue;
    touched = true;
    muted = enabled ? muted.filter((c) => c !== category) : muted.includes(category) ? muted : [...muted, category];
  }
  if (touched) out.mutedCategories = muted;
  return out;
}
