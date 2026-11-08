import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import type { RegisterDeviceRequest } from "@/lib/mobile-api";
import { lastSeenIsStale, toDeviceDto, tokenRefused, type DeviceRow } from "./devices";

/**
 * The phone registry (CAREYOS_MOBILE_APP_PLAN.md §D.3). The CareyOS portal
 * still decides who may use the CRM; this only lets the CRM refuse a token
 * that a revoked or signed-out phone held.
 */

const DEVICE_SELECT = {
  id: true,
  platform: true,
  appVersion: true,
  deviceName: true,
  lastSeenAt: true,
  createdAt: true,
  revokedAt: true,
} as const;

/** Per-request check for a Bearer token. One indexed read. */
export async function refusalForToken(tokenHash: string) {
  const row = await prisma.mobileDeviceToken.findUnique({
    where: { tokenHash },
    select: { endedAt: true, device: { select: { revokedAt: true } } },
  });
  return tokenRefused(row);
}

export type RegisterResult =
  | { ok: true; device: ReturnType<typeof toDeviceDto>; created: boolean }
  | { ok: false; code: "device_revoked" | "token_taken" };

/**
 * Record this installation and the token it signed in with. Idempotent: the
 * app calls it after every sign-in and on start. A revoked installation stays
 * revoked until an admin restores it.
 */
export async function registerDevice(
  userId: string,
  tokenHash: string,
  input: RegisterDeviceRequest,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<RegisterResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.mobileDevice.findUnique({
      where: { userId_installationId: { userId, installationId: input.installationId } },
      select: { ...DEVICE_SELECT },
    });
    if (existing?.revokedAt) return { ok: false as const, code: "device_revoked" as const };

    const device: DeviceRow = existing
      ? await tx.mobileDevice.update({
          where: { id: existing.id },
          data: {
            platform: input.platform,
            appVersion: input.appVersion,
            deviceName: input.deviceName ?? existing.deviceName,
            lastSeenAt: new Date(),
          },
          select: DEVICE_SELECT,
        })
      : await tx.mobileDevice.create({
          data: {
            userId,
            installationId: input.installationId,
            platform: input.platform,
            appVersion: input.appVersion,
            deviceName: input.deviceName ?? null,
          },
          select: DEVICE_SELECT,
        });

    const token = await tx.mobileDeviceToken.findUnique({
      where: { tokenHash },
      select: { deviceId: true, device: { select: { userId: true } } },
    });
    if (token && token.device.userId !== userId) {
      // A portal token belongs to one person; this cannot happen unless
      // something is badly wrong. Refuse rather than move it.
      return { ok: false as const, code: "token_taken" as const };
    }
    if (!token) {
      await tx.mobileDeviceToken.create({ data: { deviceId: device.id, tokenHash } });
    }

    if (!existing) {
      await recordAudit({
        actorUserId: userId,
        entityType: "mobile_device",
        entityId: device.id,
        action: "create",
        after: { platform: input.platform, appVersion: input.appVersion, deviceName: input.deviceName ?? null },
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }
    return { ok: true as const, device: toDeviceDto(device), created: !existing };
  });
}

/** Sign-out on the phone: this token is refused from now on. */
export async function endToken(tokenHash: string): Promise<boolean> {
  const res = await prisma.mobileDeviceToken.updateMany({
    where: { tokenHash, endedAt: null },
    data: { endedAt: new Date() },
  });
  return res.count > 0;
}

/** The device behind a token, refreshing its last-seen time now and then. */
export async function deviceForToken(tokenHash: string, appVersion?: string | null) {
  const token = await prisma.mobileDeviceToken.findUnique({
    where: { tokenHash },
    select: { device: { select: DEVICE_SELECT } },
  });
  if (!token) return null;
  const now = new Date();
  const versionChanged = appVersion && appVersion !== token.device.appVersion;
  if (lastSeenIsStale(token.device.lastSeenAt, now) || versionChanged) {
    const updated = await prisma.mobileDevice.update({
      where: { id: token.device.id },
      data: { lastSeenAt: now, ...(versionChanged ? { appVersion } : {}) },
      select: DEVICE_SELECT,
    });
    return toDeviceDto(updated);
  }
  return toDeviceDto(token.device);
}

export async function listDevices() {
  const rows = await prisma.mobileDevice.findMany({
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }],
    select: {
      ...DEVICE_SELECT,
      revokedReason: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      revokedBy: { select: { firstName: true, lastName: true } },
      _count: { select: { tokens: { where: { endedAt: null } } } },
    },
  });
  return rows.map((r) => ({
    ...toDeviceDto(r),
    revokedReason: r.revokedReason,
    revokedBy: r.revokedBy ? `${r.revokedBy.firstName} ${r.revokedBy.lastName}`.trim() : null,
    user: r.user,
    activeSessions: r._count.tokens,
  }));
}

export async function revokeDevice(
  id: string,
  actorUserId: string,
  reason: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const before = await prisma.mobileDevice.findUnique({ where: { id }, select: { revokedAt: true } });
  if (!before) return { ok: false as const, code: "not_found" as const };
  if (before.revokedAt) return { ok: false as const, code: "already_revoked" as const };
  const after = await prisma.mobileDevice.update({
    where: { id },
    data: { revokedAt: new Date(), revokedByUserId: actorUserId, revokedReason: reason },
    select: DEVICE_SELECT,
  });
  await recordAudit({
    actorUserId,
    entityType: "mobile_device",
    entityId: id,
    action: "mobile_device_revoked",
    after: { reason },
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true as const, device: toDeviceDto(after) };
}

/**
 * Let a revoked phone sign in again. The tokens it held before stay refused:
 * the person signs in afresh.
 */
export async function restoreDevice(
  id: string,
  actorUserId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const before = await prisma.mobileDevice.findUnique({
    where: { id },
    select: { revokedAt: true, revokedReason: true },
  });
  if (!before) return { ok: false as const, code: "not_found" as const };
  if (!before.revokedAt) return { ok: false as const, code: "not_revoked" as const };
  const after = await prisma.$transaction(async (tx) => {
    await tx.mobileDeviceToken.updateMany({ where: { deviceId: id, endedAt: null }, data: { endedAt: new Date() } });
    return tx.mobileDevice.update({
      where: { id },
      data: { revokedAt: null, revokedByUserId: null, revokedReason: null },
      select: DEVICE_SELECT,
    });
  });
  await recordAudit({
    actorUserId,
    entityType: "mobile_device",
    entityId: id,
    action: "mobile_device_restored",
    before: { revokedReason: before.revokedReason },
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true as const, device: toDeviceDto(after) };
}
