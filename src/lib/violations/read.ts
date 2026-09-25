import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { TASK_LIST_INCLUDE } from "@/lib/tasks/include";
import { taskVisibilityFilter, type VisibilityScope } from "@/lib/tasks/access";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { loadWorkflowSummariesByInstance, type JobWorkflowSummary } from "@/lib/workflows/summary";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { canViewCase, casePermissions, type ViolationActor } from "./access";
import { deriveCaseAlerts } from "./alerts";
import { ViolationError } from "./errors";
import { fineSummaryFor } from "./fines";
import { CASE_DETAIL_INCLUDE, CASE_LIST_INCLUDE, type CaseDetailRow, type CaseListRow } from "./include";
import { buildViolationListWhere, type ViolationListParams } from "./query";
import { closureBlockers } from "./rules";
import { caseScopeFor } from "./scope";
import { deriveCaseState, type CaseStateInput } from "./state";

/**
 * The read models: one case with everything its page needs, and the list
 * rows with what the queues and columns need. Both derive the same
 * state/fines/alerts from the same pure functions.
 */

const ISSUED = ["ISSUED", "IN_PROGRESS", "FINAL"] as const;

function stateInputFor(
  c: {
    status: CaseDetailRow["status"];
    currentDeadline: Date | null;
    nextHearingAt: Date | null;
    reinspectionRequestedAt: Date | null;
    agencyConfirmedAt: Date | null;
    correctiveWorkCompletedAt: Date | null;
    extensionStatus: CaseDetailRow["extensionStatus"];
    emergency: boolean;
    constructionRequired: boolean;
    lienStatus: CaseDetailRow["lienStatus"];
  },
  extra: { finesAccruing: boolean; permitStatus: CaseStateInput["permitStatus"]; permitIssued: boolean; nextInspectionAt: Date | null; phase: CaseStateInput["phase"]; blockedSteps: number },
): CaseStateInput {
  return {
    status: c.status,
    currentDeadline: c.currentDeadline,
    nextHearingAt: c.nextHearingAt,
    nextInspectionAt: extra.nextInspectionAt,
    reinspectionRequestedAt: c.reinspectionRequestedAt,
    agencyConfirmedAt: c.agencyConfirmedAt,
    correctiveWorkCompletedAt: c.correctiveWorkCompletedAt,
    extensionStatus: c.extensionStatus,
    emergency: c.emergency,
    constructionRequired: c.constructionRequired,
    lienStatus: c.lienStatus,
    finesAccruing: extra.finesAccruing,
    permitStatus: extra.permitStatus,
    permitIssued: extra.permitIssued,
    phase: extra.phase,
    blockedSteps: extra.blockedSteps,
  };
}

async function nextActionsFor(caseIds: string[], user: ViolationActor, scope: VisibilityScope | undefined) {
  if (caseIds.length === 0) return new Map<string, Prisma.TaskGetPayload<{ include: typeof TASK_LIST_INCLUDE }>>();
  const rows = await prisma.task.findMany({
    where: { AND: [{ violationCaseId: { in: caseIds }, ...ACTIVE_OPEN_WHERE }, taskVisibilityFilter(user, scope)] },
    include: TASK_LIST_INCLUDE,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { workflowSortOrder: "asc" }, { createdAt: "asc" }],
  });
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.violationCaseId && !out.has(r.violationCaseId)) out.set(r.violationCaseId, r);
  return out;
}

export async function readCase(id: string, user: ViolationActor) {
  const now = new Date();
  const [row, scope] = await Promise.all([prisma.codeViolationCase.findUnique({ where: { id }, include: CASE_DETAIL_INCLUDE }), caseScopeFor(id)]);
  if (!row || !scope) return null;
  if (!canViewCase(user, scope)) throw new ViolationError(403, "You cannot view this case");
  const permissions = casePermissions(user, scope);

  const visibility = await visibilityScopeFor(user);
  const [nextActions, summaries, blockedSteps, openBlockingSteps] = await Promise.all([
    nextActionsFor([id], user, visibility),
    row.workflow ? loadWorkflowSummariesByInstance([row.workflow.id], now) : Promise.resolve(new Map<string, JobWorkflowSummary>()),
    row.workflow ? prisma.task.count({ where: { workflowInstanceId: row.workflow.id, workflowTaskKey: { not: null }, status: "BLOCKED" } }) : Promise.resolve(0),
    row.workflow ? prisma.task.count({ where: { workflowInstanceId: row.workflow.id, workflowTaskKey: { not: null }, blocking: true, ...ACTIVE_OPEN_WHERE } }) : Promise.resolve(0),
  ]);
  const summary = row.workflow ? (summaries.get(row.workflow.id) ?? null) : null;
  const fines = fineSummaryFor(row, now);
  const nextInspectionAt = row.inspections.filter((i) => (i.status === "REQUESTED" || i.status === "SCHEDULED") && i.scheduledFor && i.scheduledFor >= now).map((i) => i.scheduledFor!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const permitIssued = row.job?.permits.some((p) => (ISSUED as readonly string[]).includes(p.status)) ?? false;
  const state = deriveCaseState(
    stateInputFor(row, { finesAccruing: fines.accruing, permitStatus: row.workflow?.permitStatus ?? null, permitIssued, nextInspectionAt, phase: summary?.currentPhase ?? null, blockedSteps }),
    now,
  );
  const alerts = deriveCaseAlerts(
    { state, currentDeadline: row.currentDeadline, nextHearingAt: row.nextHearingAt, nextInspectionAt, reinspectionRequestedAt: row.reinspectionRequestedAt, fines: { accruing: fines.accruing, dailyFine: fines.accrual.dailyFine, accrued: fines.accrual.accrued, days: fines.accrual.days, officialBalance: fines.officialBalance }, noticeType: row.noticeType, closureOverrideReason: row.closureOverrideReason },
    now,
  );
  const blockers = closureBlockers({
    items: row.items,
    agencyConfirmedAt: row.agencyConfirmedAt,
    lienStatus: row.lienStatus,
    officialBalance: row.officialBalance === null ? null : Number(row.officialBalance),
    fineResolvedAt: row.fineResolvedAt,
    openBlockingSteps,
  });

  return {
    ...row,
    permissions,
    fines,
    state,
    alerts,
    closureBlockers: blockers,
    nextAction: nextActions.get(id) ?? null,
    workflowSummary: summary,
    nextInspectionAt,
  };
}

export type CaseDetail = NonNullable<Awaited<ReturnType<typeof readCase>>>;

export async function listCases(params: ViolationListParams, user: ViolationActor) {
  const now = new Date();
  const where = buildViolationListWhere(params, { user, now });
  const [rows, total] = await Promise.all([
    prisma.codeViolationCase.findMany({
      where,
      include: CASE_LIST_INCLUDE,
      orderBy: [{ currentDeadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.codeViolationCase.count({ where }),
  ]);
  const visibility = await visibilityScopeFor(user);
  const instanceIds = rows.flatMap((r) => (r.workflow ? [r.workflow.id] : []));
  const [summaries, nextActions, blocked, issuedPermits] = await Promise.all([
    loadWorkflowSummariesByInstance(instanceIds, now),
    nextActionsFor(rows.map((r) => r.id), user, visibility),
    instanceIds.length
      ? prisma.task.groupBy({ by: ["workflowInstanceId"], where: { workflowInstanceId: { in: instanceIds }, workflowTaskKey: { not: null }, status: "BLOCKED" }, _count: { _all: true } })
      : Promise.resolve([] as { workflowInstanceId: string | null; _count: { _all: number } }[]),
    rows.some((r) => r.jobId)
      ? prisma.jobPermit.findMany({ where: { jobId: { in: rows.flatMap((r) => (r.jobId ? [r.jobId] : [])) }, status: { in: [...ISSUED] } }, select: { jobId: true } })
      : Promise.resolve([] as { jobId: string }[]),
  ]);
  const blockedBy = new Map(blocked.map((b) => [b.workflowInstanceId, b._count._all]));
  const issuedJobs = new Set(issuedPermits.map((p) => p.jobId));

  const data = rows.map((r: CaseListRow) => {
    const summary = r.workflow ? (summaries.get(r.workflow.id) ?? null) : null;
    const fines = fineSummaryFor(r, now);
    const state = deriveCaseState(
      stateInputFor(r, { finesAccruing: fines.accruing, permitStatus: r.workflow?.permitStatus ?? null, permitIssued: r.jobId ? issuedJobs.has(r.jobId) : false, nextInspectionAt: null, phase: summary?.currentPhase ?? null, blockedSteps: r.workflow ? (blockedBy.get(r.workflow.id) ?? 0) : 0 }),
      now,
    );
    const next = nextActions.get(r.id);
    return {
      ...r,
      state,
      fines: { accruing: fines.accruing, exposure: fines.exposure, systemEstimate: fines.systemEstimate, officialBalance: fines.officialBalance },
      workflow: r.workflow ? { ...r.workflow, summary } : null,
      nextAction: next ? { id: next.id, title: next.title, dueAt: next.dueAt, assignedTo: next.assignedTo } : null,
    };
  });
  return { data, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export type CaseListItem = Awaited<ReturnType<typeof listCases>>["data"][number];

/** Where-fragment for "cases this user may see", reused by the schedule lists. */
export function viewerRole(user: { id: string; role: RoleName }): ViolationActor {
  return { id: user.id, role: user.role };
}
