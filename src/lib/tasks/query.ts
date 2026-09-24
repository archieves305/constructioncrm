import type { Prisma, RoleName } from "@/generated/prisma/client";
import { taskVisibilityFilter } from "./access";
import { OPEN_TASK_STATUSES } from "./status";

/**
 * Translate `GET /api/tasks` query params into a Prisma `where`.
 *
 * Pure, so the interesting rules — which statuses a default list shows, what
 * `assignedUserId=me` means, that the role scope is ALWAYS applied — are
 * testable without a database. Every entity panel filters through here, which
 * is what keeps a sales rep from reading another rep's tasks off a job page.
 */

const LINK_PARAMS = ["leadId", "jobId", "estimateId", "invoiceId", "prospectId", "dailyLogId"] as const;

export type TaskListParams = {
  assignedUserId?: string;
  status?: string;
  priority?: string;
  overdue?: boolean;
  includeCompleted?: boolean;
} & Partial<Record<(typeof LINK_PARAMS)[number], string>>;

export function readTaskListParams(searchParams: URLSearchParams): TaskListParams {
  const out: TaskListParams = {
    assignedUserId: searchParams.get("assignedUserId") || undefined,
    status: searchParams.get("status") || undefined,
    priority: searchParams.get("priority") || undefined,
    overdue: searchParams.get("overdue") === "true" || searchParams.get("overdue") === "1",
    includeCompleted: searchParams.get("includeCompleted") === "true",
  };
  for (const key of LINK_PARAMS) {
    const v = searchParams.get(key);
    if (v) out[key] = v;
  }
  return out;
}

export function buildTaskListWhere(
  params: TaskListParams,
  user: { id: string; role: RoleName },
  now: Date = new Date(),
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};

  if (params.assignedUserId) {
    where.assignedUserId = params.assignedUserId === "me" ? user.id : params.assignedUserId;
  }
  if (params.priority) where.priority = params.priority as Prisma.EnumPriorityFilter["equals"];
  for (const key of LINK_PARAMS) {
    if (params[key]) where[key] = params[key];
  }

  if (params.overdue) {
    where.dueAt = { lt: now };
    where.status = { in: [...OPEN_TASK_STATUSES] };
  } else if (params.status) {
    where.status = params.status as Prisma.EnumTaskStatusFilter["equals"];
  } else if (!params.includeCompleted) {
    where.status = { in: [...OPEN_TASK_STATUSES] };
  }

  return { AND: [where, taskVisibilityFilter(user)] };
}
