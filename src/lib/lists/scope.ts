// "Mine" vs "All" for the jobs and leads lists and boards. Client-safe: no
// Prisma import. The API default stays "all" because seven pickers call the
// list routes with no scope; the pages resolve their own default from the
// URL, then the saved preference, then MINE.

import type { RoleName } from "@/generated/prisma/enums";

export type ListScope = "mine" | "all";
export const LIST_SCOPES = ["mine", "all"] as const;

export type ListScopePref = "MINE" | "ALL";

/**
 * Roles pinned to Mine whatever they ask for. Explicit list, never hasMinRole.
 * MARKETING is deliberately absent: it needs every lead for campaigns.
 */
export const SCOPE_FLOOR_ROLES: readonly RoleName[] = ["SALES_REP", "CREW_LEAD"];

export function parseListScope(v: string | null | undefined): ListScope | undefined {
  return v === "mine" || v === "all" ? v : undefined;
}

export function isScopeForced(role: RoleName): boolean {
  return SCOPE_FLOOR_ROLES.includes(role);
}

/** Server side: what the query actually uses. The floor wins over any request. */
export function effectiveListScope(requested: ListScope | undefined, role: RoleName): ListScope {
  if (isScopeForced(role)) return "mine";
  return requested ?? "all";
}

/** Client side: URL param > saved preference > MINE, then the floor. */
export function resolveClientScope(input: { url?: string | null; pref?: ListScopePref | null; role?: RoleName | null }): ListScope {
  if (input.role && isScopeForced(input.role)) return "mine";
  const fromUrl = parseListScope(input.url);
  if (fromUrl) return fromUrl;
  if (input.pref === "ALL") return "all";
  return "mine";
}

export function scopeToPref(scope: ListScope): ListScopePref {
  return scope === "all" ? "ALL" : "MINE";
}
