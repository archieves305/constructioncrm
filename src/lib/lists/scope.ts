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

/**
 * The Tasks page: Mine unless this visit's URL says `scope=all`. The saved
 * list preference is deliberately not read — the page opens on the signed-in
 * person's tasks for everyone, every time. No role floor: the task API
 * already limits an own-only role, so their "Everyone" is the tasks on their
 * own jobs.
 */
export function resolveTaskScope(input: { url?: string | null }): ListScope {
  return parseListScope(input.url) ?? "mine";
}

/**
 * Whose tasks the list asks for: an explicit `assignedUserId` in the URL
 * (a person, or "me") wins; otherwise Mine means the signed-in person and
 * Everyone means no assignee filter. "me" and an unknown session both
 * resolve to "me", which the API accepts.
 */
export function taskAssigneeFor(input: { explicit: string | null | undefined; scope: ListScope; userId: string | null | undefined }): string {
  if (input.explicit) return input.explicit === "me" ? (input.userId ?? "me") : input.explicit;
  return input.scope === "mine" ? (input.userId ?? "me") : "";
}

/**
 * Whom a task created from a list should go to by default: the person the list
 * is showing (Mine = me, or an explicit assignee filter), so the new task stays
 * in view. Everyone → nobody. "me" not yet resolved to an id → nobody.
 */
export function newTaskAssigneeFor(listAssignee: string): string | undefined {
  return listAssignee && listAssignee !== "me" ? listAssignee : undefined;
}

/** True when a task just created will not appear in a list filtered to `listAssignee`. */
export function createdOutsideList(taskAssigneeId: string | null | undefined, listAssignee: string): boolean {
  return Boolean(listAssignee) && listAssignee !== "me" && (taskAssigneeId ?? "") !== listAssignee;
}
