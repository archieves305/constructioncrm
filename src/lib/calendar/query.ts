import type { Prisma, Priority, RoleName, TaskStatus } from "@/generated/prisma/client";
import { taskVisibilityFilter, type VisibilityScope } from "@/lib/tasks/access";
import { taskSearchWhere } from "@/lib/tasks/query";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { APP_TIME_ZONE, diffDayKeys, endOfDayIn, isDayKey, startOfDayIn, type DayKey } from "@/lib/time/zone";
import type { UsersSelection } from "./access";

/**
 * `GET /api/calendar` and `/api/calendar/unscheduled` → Prisma `where`.
 *
 * Pure, like `buildTaskListWhere`, and built from the same parts: the
 * open-and-activated default, the shared search block, and the role
 * visibility filter ALWAYS last. The only new idea is the range test — an
 * item is on screen when its span `[scheduledStart ?? dueAt, dueAt]`
 * touches `[from, to]` in the office's zone.
 */

export const CALENDAR_CAP = 2000;
export const MAX_RANGE_DAYS = 62;
export const UNSCHEDULED_CAP = 400;

const TASK_STATUSES = new Set<string>(["PENDING", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]);
const PRIORITIES = new Set<string>(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export type CalendarParams = {
  from: DayKey;
  to: DayKey;
  /** Raw `?users=`; the route coerces it with `coerceUsersParam` once it knows the role. */
  users: string | null;
  jobId?: string;
  status?: TaskStatus[];
  priority?: Priority[];
  q?: string;
  /** Show COMPLETED / CANCELLED too. Default false. */
  includeCompleted: boolean;
};

export type CalendarParamsResult = { ok: true; params: CalendarParams } | { ok: false; error: string };

function csv<T extends string>(raw: string | null, allowed: Set<string>): T[] | undefined {
  if (!raw) return undefined;
  const vals = raw.split(",").map((s) => s.trim()).filter((s) => allowed.has(s)) as T[];
  return vals.length ? Array.from(new Set(vals)) : undefined;
}

export function readCalendarParams(sp: URLSearchParams): CalendarParamsResult {
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDayKey(from) || !isDayKey(to)) return { ok: false, error: "from and to must be yyyy-MM-dd" };
  const span = diffDayKeys(from, to);
  if (span < 0) return { ok: false, error: "to must not be before from" };
  if (span >= MAX_RANGE_DAYS) return { ok: false, error: `The range may cover at most ${MAX_RANGE_DAYS} days` };
  return {
    ok: true,
    params: {
      from,
      to,
      users: sp.get("users"),
      jobId: sp.get("jobId")?.trim() || undefined,
      status: csv<TaskStatus>(sp.get("status"), TASK_STATUSES),
      priority: csv<Priority>(sp.get("priority"), PRIORITIES),
      q: sp.get("q")?.trim() || undefined,
      includeCompleted: sp.get("includeCompleted") === "true" || sp.get("includeCompleted") === "1",
    },
  };
}

export type UnscheduledParams = { users: string | null; jobId?: string; q?: string };

export function readUnscheduledParams(sp: URLSearchParams): UnscheduledParams {
  return { users: sp.get("users"), jobId: sp.get("jobId")?.trim() || undefined, q: sp.get("q")?.trim() || undefined };
}

/** Whose tasks. `all` adds nothing; the visibility filter still applies. */
export function usersClause(sel: UsersSelection, user: { id: string }): Prisma.TaskWhereInput {
  if (sel.kind === "me") return { assignedUserId: user.id };
  if (sel.kind === "all") return {};
  const or: Prisma.TaskWhereInput[] = [];
  if (sel.ids.length) or.push({ assignedUserId: { in: sel.ids } });
  if (sel.includeUnassigned) or.push({ assignedUserId: null });
  return or.length === 1 ? or[0] : { OR: or };
}

export function buildCalendarWhere(
  params: CalendarParams,
  sel: UsersSelection,
  user: { id: string; role: RoleName },
  scope?: VisibilityScope,
  tz: string = APP_TIME_ZONE,
): Prisma.TaskWhereInput {
  const rangeStart = startOfDayIn(params.from, tz);
  const rangeEnd = endOfDayIn(params.to, tz);

  const and: Prisma.TaskWhereInput[] = [
    // Ends on or after the first day…
    { dueAt: { gte: rangeStart } },
    // …and starts on or before the last day (a span may start earlier).
    { OR: [{ scheduledStart: { lte: rangeEnd } }, { scheduledStart: null, dueAt: { lte: rangeEnd } }] },
    // A Not-active workflow step is nobody's work yet.
    { activatedAt: { not: null } },
  ];

  if (params.status?.length) and.push({ status: { in: params.status } });
  else if (!params.includeCompleted) and.push({ status: { in: [...OPEN_TASK_STATUSES] } });

  and.push(usersClause(sel, user));
  if (params.jobId) and.push({ jobId: params.jobId });
  if (params.priority?.length) and.push({ priority: { in: params.priority } });
  if (params.q) and.push(taskSearchWhere(params.q));

  and.push(taskVisibilityFilter(user, scope));
  return { AND: and };
}

/** Active, open, and nobody has given it a day. Never an inactive step. */
export function buildUnscheduledWhere(
  params: UnscheduledParams,
  sel: UsersSelection,
  user: { id: string; role: RoleName },
  scope?: VisibilityScope,
): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [
    { status: { in: [...OPEN_TASK_STATUSES] }, activatedAt: { not: null }, dueAt: null },
    usersClause(sel, user),
  ];
  if (params.jobId) and.push({ jobId: params.jobId });
  if (params.q) and.push(taskSearchWhere(params.q));
  and.push(taskVisibilityFilter(user, scope));
  return { AND: and };
}
