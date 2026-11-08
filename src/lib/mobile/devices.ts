import { createHash } from "node:crypto";
import { z } from "zod";
import type { MobileDeviceDto } from "@/lib/mobile-api";

/**
 * Pure pieces of the phone registry (CAREYOS_MOBILE_APP_PLAN.md §D.3).
 * The database side is device-service.ts.
 */

/** sha256 (hex) of a CareyOS session token. Tokens are never stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A token row as read for the per-request check. */
export type TokenState = {
  endedAt: Date | null;
  device: { revokedAt: Date | null };
} | null;

/**
 * Whether a Bearer request carrying this token is refused. A token the CRM
 * has never seen is allowed: the portal has already proven it, and the app
 * registers it right after sign-in. Revoking works on every token a phone
 * has registered, and signing out ends that one token.
 */
export function tokenRefused(row: TokenState): "device_revoked" | "signed_out" | null {
  if (!row) return null;
  if (row.device.revokedAt) return "device_revoked";
  if (row.endedAt) return "signed_out";
  return null;
}

export const revokeRequest = z.object({
  reason: z.string().trim().min(3, "Say why, in a few words").max(300),
});

export type DeviceRow = {
  id: string;
  platform: string;
  appVersion: string | null;
  deviceName: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
};

export function toDeviceDto(d: DeviceRow): MobileDeviceDto {
  return {
    id: d.id,
    platform: d.platform === "android" ? "android" : "ios",
    appVersion: d.appVersion,
    deviceName: d.deviceName,
    lastSeenAt: d.lastSeenAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
    revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
  };
}

/** Who may see everyone's phones and switch one off. */
export function canManageMobileDevices(role: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/** How often a Bearer request refreshes the phone's "last seen". */
export const LAST_SEEN_EVERY_MS = 10 * 60 * 1000;

export function lastSeenIsStale(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_EVERY_MS;
}
