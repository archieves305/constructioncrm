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
 * Extra `where` clause narrowing a task query to what this role may see.
 * Returns an empty object for roles that see everything.
 */
export function taskVisibilityFilter(user: {
  id: string;
  role: RoleName;
}): Prisma.TaskWhereInput {
  if (FULL_ACCESS.has(user.role)) return {};
  if (user.role === "READ_ONLY") return {};
  // Own-only roles see their own queue: assigned to them, or raised by them.
  return {
    OR: [{ assignedUserId: user.id }, { createdByUserId: user.id }],
  };
}

export function canViewTask(
  user: { id: string; role: RoleName },
  task: TaskOwnership,
): boolean {
  if (FULL_ACCESS.has(user.role) || user.role === "READ_ONLY") return true;
  return task.assignedUserId === user.id || task.createdByUserId === user.id;
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
  task: TaskOwnership,
): boolean {
  return canViewTask(user, task);
}
