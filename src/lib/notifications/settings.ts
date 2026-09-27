import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import type { ClassifySettings } from "./classify";
import type { WindowSettings } from "./windows";

/**
 * The company-wide delivery settings singleton, created with defaults on
 * first read (the NurtureSettings / EmailBrand pattern) and cached for a
 * minute: `notify()` runs on every task write and must not add a query.
 */

export type NotificationSettingsRow = Awaited<ReturnType<typeof loadNotificationSettingsUncached>>;

const CACHE_MS = 60_000;
let cache: { row: NotificationSettingsRow; at: number } | null = null;

async function loadNotificationSettingsUncached() {
  return prisma.notificationSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}

export async function loadNotificationSettings(): Promise<NotificationSettingsRow> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.row;
  const row = await loadNotificationSettingsUncached();
  cache = { row, at: Date.now() };
  return row;
}

export function invalidateNotificationSettingsCache(): void {
  cache = null;
}

/** Deploy gate: with the env flag off nothing is recorded and the legacy mail runs untouched. */
export function isNotificationsV2Recording(): boolean {
  return env.NOTIFICATIONS_V2 === "1";
}

/** Both gates on: v2 owns delivery (digests + immediate) and the legacy senders stand down. */
export function isDeliveryTakenOver(settings: Pick<NotificationSettingsRow, "enabled">): boolean {
  return isNotificationsV2Recording() && settings.enabled;
}

export function classifySettingsOf(row: NotificationSettingsRow): ClassifySettings {
  return {
    immediateKinds: row.immediateKinds,
    digestOnlyKinds: row.digestOnlyKinds,
    maxImmediatePerUserPerHour: row.maxImmediatePerUserPerHour,
    batchCollapseThreshold: row.batchCollapseThreshold,
  };
}

export function windowSettingsOf(row: NotificationSettingsRow): WindowSettings {
  return {
    timeZone: row.timeZone,
    digestWindows: row.digestWindows,
    weekdaysOnly: row.weekdaysOnly,
    catchUpGraceMinutes: row.catchUpGraceMinutes,
  };
}
