import type { RoleName } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Who may see and change which tasks.
 *
 * This exists because the read and write sides had drifted apart: the task
 * list scoped a SALES_REP to their own rows, but PATCH checked only that a
 * session existed, so any authenticated user could modify any task by id.
 * Both sides now derive from the same rules.
 */

/** Roles that work the whole board — office coordination is their job. */
const FULL_ACCESS: ReadonlySet<RoleName> = new Set<RoleName>([
  "ADMIN",
  "MANAGER",
  "OFFICE_STAFF",
]);

/** Roles that may act only on tasks they own or raised. */
const OWN_ONLY: ReadonlySet<RoleName> = new Set<RoleName>([
  "SALES_REP",
  "CREW_LEAD",
  "MARKETING",
]);

export type TaskOwnership = {
  assignedUserId: string | null;
  createdByUserId: string;
};

/**
 * Jobs an own-only user is on (as PM, team slot or field assignment). Tasks
 * on those jobs are visible to them even when assigned to someone else, so
 * a PM sees the whole workflow they run. Resolved per request by
 * `visibilityScopeFor`; pure code only ever receives the id list.
 */
export type VisibilityScope = { jobIds: string[] };

export function seesAllTasks(role: RoleName): boolean {
  return FULL_ACCESS.has(role) || role === "READ_ONLY";
}

/**
 * Extra `where` clause narrowing a task query to what this role may see.
 * Returns an empty object for roles that see everything.
 */
export function taskVisibilityFilter(
  user: { id: string; role: RoleName },
  scope?: VisibilityScope,
): Prisma.TaskWhereInput {
  if (seesAllTasks(user.role)) return {};
  // Own-only roles see their own queue — assigned to them, or raised by them —
  // plus everything on the jobs they are on.
  return {
    OR: [
      { assignedUserId: user.id },
      { createdByUserId: user.id },
      ...(scope && scope.jobIds.length > 0 ? [{ jobId: { in: scope.jobIds } }] : []),
    ],
  };
}

export function canViewTask(
  user: { id: string; role: RoleName },
  task: TaskOwnership & { jobId?: string | null },
  scope?: VisibilityScope,
): boolean {
  if (seesAllTasks(user.role)) return true;
  if (task.assignedUserId === user.id || task.createdByUserId === user.id) return true;
  return Boolean(scope && task.jobId && scope.jobIds.includes(task.jobId));
}

export function canEditTask(
  user: { id: string; role: RoleName },
  task: TaskOwnership,
): boolean {
  if (FULL_ACCESS.has(user.role)) return true;
  if (!OWN_ONLY.has(user.role)) return false; // READ_ONLY and anything new
  return task.assignedUserId === user.id || task.createdByUserId === user.id;
}

/**
 * Notes are the collaboration surface, so anyone who can see a task may add
 * one — including READ_ONLY, whose role restricts changing the work, not
 * commenting on it.
 */
export function canCommentOnTask(
  user: { id: string; role: RoleName },
  task: TaskOwnership & { jobId?: string | null },
  scope?: VisibilityScope,
): boolean {
  return canViewTask(user, task, scope);
}

/**
 * Who may send a nudge: the office roles, or whoever raised the task. Not
 * `canEditTask` — an own-only assignee can edit their own task but nudging
 * themselves is meaningless, and READ_ONLY never nudges.
 */
export function canNudgeTask(
  user: { id: string; role: RoleName },
  task: TaskOwnership,
): boolean {
  if (FULL_ACCESS.has(user.role)) return true;
  if (user.role === "READ_ONLY") return false;
  return task.createdByUserId === user.id;
}

/**
 * Deleting is narrower than editing: the office roles, or whoever raised the
 * task. An assignee may finish or hand back work that was put on them, but
 * not make it disappear.
 */
export function canDeleteTask(
  user: { id: string; role: RoleName },
  task: TaskOwnership,
): boolean {
  if (FULL_ACCESS.has(user.role)) return true;
  if (user.role === "READ_ONLY") return false;
  return task.createdByUserId === user.id;
}
