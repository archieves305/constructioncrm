import type { RoleName } from "@/generated/prisma/client";

/** Explicit role lists (never hasMinRole) for the notification admin surfaces. */
export const NOTIFICATIONS_VIEW_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER"];
export const NOTIFICATIONS_MANAGE_ROLES: readonly RoleName[] = ["ADMIN"];

export function canViewNotificationSettings(role: RoleName): boolean {
  return NOTIFICATIONS_VIEW_ROLES.includes(role);
}

export function canManageNotificationSettings(role: RoleName): boolean {
  return NOTIFICATIONS_MANAGE_ROLES.includes(role);
}
