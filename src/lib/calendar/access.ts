import type { RoleName } from "@/generated/prisma/enums";
import { canEditTask, seesAllTasks, type TaskOwnership } from "@/lib/tasks/access";

/**
 * Who may look at whose calendar, and who may run the dispatch board.
 *
 * Explicit role sets, never `hasMinRole` (the hierarchy ranks SALES_REP above
 * OFFICE_STAFF, which is backwards for coordination work). Viewing follows
 * the task visibility rule exactly — `canViewAllCalendars` IS `seesAllTasks`,
 * imported rather than re-listed so the two cannot drift. Changing a task's
 * place on the calendar is editing the task, so it stays `canEditTask`.
 *
 * Client-safe: type-only Prisma imports.
 */

/** Roles that schedule other people's work: the People board and the Unscheduled rail. */
const DISPATCH_ROLES: ReadonlySet<RoleName> = new Set<RoleName>(["ADMIN", "MANAGER", "OFFICE_STAFF"]);

export function canDispatch(role: RoleName | null | undefined): boolean {
  return role != null && DISPATCH_ROLES.has(role);
}

/** Other people's calendars and "Everyone": the office roles plus READ_ONLY. */
export function canViewAllCalendars(role: RoleName): boolean {
  return seesAllTasks(role);
}

export function canViewCalendarOf(user: { id: string; role: RoleName }, targetUserId: string): boolean {
  return user.id === targetUserId || canViewAllCalendars(user.role);
}

/** Moving a task on the calendar is editing it. */
export function canScheduleTask(user: { id: string; role: RoleName }, task: TaskOwnership): boolean {
  return canEditTask(user, task);
}

export const UNASSIGNED_SENTINEL = "unassigned";

export type UsersSelection =
  | { kind: "me" }
  | { kind: "all" }
  | { kind: "ids"; ids: string[]; includeUnassigned: boolean };

/**
 * `?users=` → a selection the query builder can trust. Own-only roles get
 * their own calendar whatever they asked for; MARKETING is floored here too
 * (unlike the lists' `SCOPE_FLOOR_ROLES`) because the task rule floors it.
 */
export function coerceUsersParam(raw: string | null | undefined, role: RoleName): UsersSelection {
  if (!canViewAllCalendars(role)) return { kind: "me" };
  const v = raw?.trim();
  if (!v || v === "me") return { kind: "me" };
  if (v === "all") return { kind: "all" };
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  const includeUnassigned = parts.includes(UNASSIGNED_SENTINEL);
  const ids = Array.from(new Set(parts.filter((p) => p !== UNASSIGNED_SENTINEL)));
  if (ids.length === 0 && !includeUnassigned) return { kind: "me" };
  return { kind: "ids", ids, includeUnassigned };
}

/** The reverse: a selection back to the `?users=` string the URL carries. */
export function usersParamOf(sel: UsersSelection): string {
  if (sel.kind === "me") return "me";
  if (sel.kind === "all") return "all";
  return [...sel.ids, ...(sel.includeUnassigned ? [UNASSIGNED_SENTINEL] : [])].join(",");
}
