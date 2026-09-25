import type { Prisma, RoleName, WorkflowPermitStatus } from "@/generated/prisma/client";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";

/**
 * The jobs-list `where`, built from query params in one pure function so the
 * filters can be tested without a database and the route stays a thin shell.
 *
 * Workflow filters read the ordinary task rows a workflow generates — there
 * is no separate workflow table to join — so "blocked", "overdue" and
 * "unassigned" mean exactly what the Workflow tab's chips mean: a workflow
 * step (workflowTaskKey set) in that state, active-open where it matters.
 */

export const PERMIT_FILTER_VALUES = ["UNDETERMINED", "REQUIRED", "NOT_REQUIRED", "NONE"] as const;
export type PermitFilter = (typeof PERMIT_FILTER_VALUES)[number];

export type JobListParams = {
  /** Jobs on one property (lead) — the violation intake's job picker. */
  leadId?: string;
  stageId?: string;
  salesRepId?: string;
  search?: string;
  /** A template key ("roofing"); jobs with that module applied and not removed. */
  workflowTrade?: string;
  /** A permit status, or NONE for jobs with no workflow at all. */
  permitStatus?: PermitFilter;
  /** Full phase key ("core:permitting"); jobs with active open work in that phase. */
  phaseKey?: string;
  workflowBlocked?: boolean;
  workflowOverdue?: boolean;
  workflowUnassigned?: boolean;
};

export type JobListContext = {
  user: { id: string; role: RoleName };
  now: Date;
};

function flag(v: string | null): boolean {
  return v === "1" || v === "true";
}

export function parseJobListParams(searchParams: URLSearchParams): JobListParams {
  const permit = searchParams.get("permitStatus");
  return {
    leadId: searchParams.get("leadId") || undefined,
    stageId: searchParams.get("stageId") || undefined,
    salesRepId: searchParams.get("salesRepId") || undefined,
    search: searchParams.get("search") || undefined,
    workflowTrade: searchParams.get("workflowTrade") || undefined,
    permitStatus: (PERMIT_FILTER_VALUES as readonly string[]).includes(permit ?? "") ? (permit as PermitFilter) : undefined,
    phaseKey: searchParams.get("phaseKey") || undefined,
    workflowBlocked: flag(searchParams.get("workflowBlocked")),
    workflowOverdue: flag(searchParams.get("workflowOverdue")),
    workflowUnassigned: flag(searchParams.get("workflowUnassigned")),
  };
}

const WORKFLOW_STEP = { workflowTaskKey: { not: null } } satisfies Prisma.TaskWhereInput;

export function buildJobListWhere(params: JobListParams, ctx: JobListContext): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [];

  if (params.leadId) and.push({ leadId: params.leadId });
  if (params.stageId) and.push({ currentStageId: params.stageId });
  if (params.salesRepId) and.push({ salesRepId: params.salesRepId });
  if (params.search) {
    and.push({
      OR: [
        { jobNumber: { contains: params.search, mode: "insensitive" } },
        { title: { contains: params.search, mode: "insensitive" } },
        { lead: { fullName: { contains: params.search, mode: "insensitive" } } },
      ],
    });
  }

  // A sales rep sees their own jobs, whatever else was asked for.
  if (ctx.user.role === "SALES_REP") and.push({ salesRepId: ctx.user.id });

  if (params.workflowTrade) {
    and.push({ workflow: { modules: { some: { templateKey: params.workflowTrade, removedAt: null } } } });
  }
  if (params.permitStatus === "NONE") {
    and.push({ workflow: { is: null } });
  } else if (params.permitStatus) {
    and.push({ workflow: { permitStatus: params.permitStatus as WorkflowPermitStatus } });
  }
  if (params.phaseKey) {
    and.push({ tasks: { some: { ...WORKFLOW_STEP, ...ACTIVE_OPEN_WHERE, workflowPhaseKey: params.phaseKey } } });
  }
  if (params.workflowBlocked) {
    and.push({ tasks: { some: { ...WORKFLOW_STEP, status: "BLOCKED" } } });
  }
  if (params.workflowOverdue) {
    and.push({ tasks: { some: { ...WORKFLOW_STEP, ...ACTIVE_OPEN_WHERE, dueAt: { lt: ctx.now } } } });
  }
  if (params.workflowUnassigned) {
    and.push({ tasks: { some: { ...WORKFLOW_STEP, ...ACTIVE_OPEN_WHERE, assignedUserId: null } } });
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

/** True when any workflow filter is set — the route then loads summaries so the list can show why a job matched. */
export function hasWorkflowFilter(p: JobListParams): boolean {
  return Boolean(p.workflowTrade || p.permitStatus || p.phaseKey || p.workflowBlocked || p.workflowOverdue || p.workflowUnassigned);
}
