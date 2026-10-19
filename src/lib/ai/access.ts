import type { RoleName } from "@/generated/prisma/client";

/** Who may read what the AI layer has cost. Explicit list, never hasMinRole. */
export function canViewAiUsage(role: RoleName | string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER";
}
