import { z } from "zod";
import { NOTIFICATION_KINDS } from "@/lib/notifications/kinds";
import { isValidHHMM } from "@/lib/notifications/windows";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const kindList = z.array(z.enum(NOTIFICATION_KINDS)).max(NOTIFICATION_KINDS.length);

/** Admin → Notification Digests → Delivery. Every field optional: the page saves what it shows. */
export const notificationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    timeZone: z.string().refine(isValidTimeZone, "Not a valid IANA time zone"),
    digestWindows: z
      .array(z.string().refine(isValidHHMM, "Use HH:MM"))
      .min(1, "At least one digest time")
      .max(8)
      .transform((w) => Array.from(new Set(w)).sort()),
    weekdaysOnly: z.boolean(),
    catchUpGraceMinutes: z.number().int().min(10).max(240),
    immediateKinds: kindList,
    digestOnlyKinds: kindList,
    maxImmediatePerUserPerHour: z.number().int().min(1).max(50),
    batchCollapseThreshold: z.number().int().min(2).max(20),
    stormThresholdPer10Min: z.number().int().min(5).max(500),
    digestMaxPerSection: z.number().int().min(1).max(50),
    digestMaxPerSubject: z.number().int().min(1).max(20),
    retentionDays: z.number().int().min(7).max(365),
  })
  .partial()
  .refine((v) => !(v.immediateKinds && v.digestOnlyKinds && v.immediateKinds.some((k) => v.digestOnlyKinds!.includes(k))), { message: "A kind cannot be both always-immediate and never-immediate", path: ["immediateKinds"] });

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
