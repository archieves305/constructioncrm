import type { Prisma, RoleName } from "@/generated/prisma/client";
import { taskVisibilityFilter, type VisibilityScope } from "./access";
import { OPEN_TASK_STATUSES } from "./status";

/**
 * Translate `GET /api/tasks` query params into a Prisma `where`.
 *
 * Pure, so the interesting rules — which statuses a default list shows, what
 * `assignedUserId=me` means, that the role scope is ALWAYS applied — are
 * testable without a database. Every entity panel filters through here, which
 * is what keeps a sales rep from reading another rep's tasks off a job page.
 */

const LINK_PARAMS = ["leadId", "jobId", "estimateId", "invoiceId", "prospectId", "dailyLogId", "violationCaseId", "violationItemId"] as const;

export type TaskListParams = {
  assignedUserId?: string;
  status?: string;
  priority?: string;
  overdue?: boolean;
  includeCompleted?: boolean;
  // ── Workflow filters ──
  /** "manual" = hand-made tasks only; "workflow" = template-generated steps only. */
  source?: "manual" | "workflow";
  workflowInstanceId?: string;
  phaseKey?: string;
  moduleKey?: string;
  /** Ready = PENDING and active. */
  ready?: boolean;
  /** Waiting = not yet active (implies includeInactive). */
  waiting?: boolean;
  blocked?: boolean;
  /** Show Not-active steps alongside active work. Default false. */
  includeInactive?: boolean;
} & Partial<Record<(typeof LINK_PARAMS)[number], string>>;

const flag = (sp: URLSearchParams, key: string) => sp.get(key) === "true" || sp.get(key) === "1";

export function readTaskListParams(searchParams: URLSearchParams): TaskListParams {
  const out: TaskListParams = {
    assignedUserId: searchParams.get("assignedUserId") || undefined,
    status: searchParams.get("status") || undefined,
    priority: searchParams.get("priority") || undefined,
    overdue: flag(searchParams, "overdue"),
    includeCompleted: searchParams.get("includeCompleted") === "true",
    workflowInstanceId: searchParams.get("workflowInstanceId") || undefined,
    phaseKey: searchParams.get("phaseKey") || undefined,
    moduleKey: searchParams.get("moduleKey") || undefined,
    ready: flag(searchParams, "ready"),
    waiting: flag(searchParams, "waiting"),
    blocked: flag(searchParams, "blocked"),
    includeInactive: flag(searchParams, "includeInactive"),
  };
  const source = searchParams.get("source");
  if (source === "manual" || source === "workflow") out.source = source;
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
  scope?: VisibilityScope,
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};

  if (params.assignedUserId) {
    where.assignedUserId = params.assignedUserId === "me" ? user.id : params.assignedUserId;
  }
  if (params.priority) where.priority = params.priority as Prisma.EnumPriorityFilter["equals"];
  for (const key of LINK_PARAMS) {
    if (params[key]) where[key] = params[key];
  }

  if (params.source === "manual") where.workflowTaskKey = null;
  else if (params.source === "workflow") where.workflowTaskKey = { not: null };
  if (params.workflowInstanceId) where.workflowInstanceId = params.workflowInstanceId;
  if (params.phaseKey) where.workflowPhaseKey = params.phaseKey;
  if (params.moduleKey) where.workflowModuleKey = params.moduleKey;

  // A Not-active workflow step is nobody's work yet, so the default list
  // hides it — the same rule ACTIVE_OPEN_WHERE applies to every count.
  const showInactive = params.includeInactive || params.waiting;

  if (params.waiting) {
    where.status = "PENDING";
    where.activatedAt = null;
  } else if (params.ready) {
    where.status = "PENDING";
    where.activatedAt = { not: null };
  } else if (params.blocked) {
    where.status = "BLOCKED";
  } else if (params.overdue) {
    where.dueAt = { lt: now };
    where.status = { in: [...OPEN_TASK_STATUSES] };
    if (!showInactive) where.activatedAt = { not: null };
  } else if (params.status) {
    where.status = params.status as Prisma.EnumTaskStatusFilter["equals"];
    if (params.status === "PENDING" && !showInactive) where.activatedAt = { not: null };
  } else if (!params.includeCompleted) {
    where.status = { in: [...OPEN_TASK_STATUSES] };
    if (!showInactive) where.activatedAt = { not: null };
  } else if (!showInactive) {
    where.activatedAt = { not: null };
  }

  return { AND: [where, taskVisibilityFilter(user, scope)] };
}
