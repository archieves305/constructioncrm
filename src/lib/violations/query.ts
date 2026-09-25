import type { CodeViolationStatus, Prisma, RoleName } from "@/generated/prisma/client";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { violationVisibilityFilter } from "./access";
import { OPEN_CASE_STATUSES } from "./rules";

/**
 * `GET /api/violations` params → a Prisma `where`. Pure, so every queue the
 * sidebar links to (mine, overdue, awaiting agency…) is a tested predicate
 * and the role scope is ALWAYS applied — a sales rep on a lead page sees
 * only the cases they are on, exactly as on the list.
 */

export const VIOLATION_VIEWS = ["all", "mine", "new", "due-soon", "overdue", "fines", "awaiting-agency", "closed"] as const;
export type ViolationView = (typeof VIOLATION_VIEWS)[number];

export const VIOLATION_FLAGS = ["finesAccruing", "lienRecorded", "hearingScheduled", "permitPending", "emergency", "constructionRequired", "blocked"] as const;
export type ViolationFlag = (typeof VIOLATION_FLAGS)[number];

const STATUSES: readonly CodeViolationStatus[] = ["NEW", "ACTIVE", "ON_HOLD", "APPEALED", "COMPLIED", "CLOSED", "CANCELLED"];

export type ViolationListParams = {
  view: ViolationView;
  search?: string;
  jurisdiction?: string;
  categoryId?: string;
  /** A user id, or "__unassigned". */
  caseManagerId?: string;
  status?: CodeViolationStatus;
  phaseKey?: string;
  leadId?: string;
  jobId?: string;
  /** Cases with no linked job (the Job page's "link existing case" picker). */
  unlinked?: boolean;
  /** For due-soon: the window in days (default 7). */
  withinDays: number;
  flags: Partial<Record<ViolationFlag, boolean>>;
  page: number;
  pageSize: number;
};

const flag = (sp: URLSearchParams, key: string) => sp.get(key) === "1" || sp.get(key) === "true";

export function parseViolationListParams(sp: URLSearchParams): ViolationListParams {
  const viewRaw = sp.get("view");
  const view = (VIOLATION_VIEWS as readonly string[]).includes(viewRaw ?? "") ? (viewRaw as ViolationView) : "all";
  const statusRaw = sp.get("status");
  const status = (STATUSES as readonly string[]).includes(statusRaw ?? "") ? (statusRaw as CodeViolationStatus) : undefined;
  const flags: Partial<Record<ViolationFlag, boolean>> = {};
  for (const f of VIOLATION_FLAGS) if (flag(sp, f)) flags[f] = true;
  const withinDays = Math.min(Math.max(parseInt(sp.get("withinDays") ?? "7", 10) || 7, 1), 365);
  return {
    view,
    search: sp.get("search")?.trim() || undefined,
    jurisdiction: sp.get("jurisdiction")?.trim() || undefined,
    categoryId: sp.get("categoryId") || undefined,
    caseManagerId: sp.get("caseManagerId") || undefined,
    status,
    phaseKey: sp.get("phaseKey") || undefined,
    leadId: sp.get("leadId") || undefined,
    jobId: sp.get("jobId") || undefined,
    unlinked: flag(sp, "unlinked") || undefined,
    withinDays,
    flags,
    page: Math.max(parseInt(sp.get("page") ?? "1", 10) || 1, 1),
    pageSize: Math.min(Math.max(parseInt(sp.get("pageSize") ?? "25", 10) || 25, 1), 5000),
  };
}

export type ViolationListContext = { user: { id: string; role: RoleName }; now: Date };

/** Fines are accruing when a daily rate is set, accrual has started and nothing official has stopped it. */
export function finesAccruingWhere(now: Date): Prisma.CodeViolationCaseWhereInput {
  return { dailyFine: { gt: 0 }, fineAccrualStartDate: { lte: now }, fineAccrualStoppedAt: null };
}

export const AWAITING_AGENCY_WHERE: Prisma.CodeViolationCaseWhereInput = { reinspectionRequestedAt: { not: null }, agencyConfirmedAt: null };

const PERMIT_ISSUED_STATUSES = ["ISSUED", "IN_PROGRESS", "FINAL"] as const;

/** Permit required (or undecided) and nothing issued on the linked job yet. */
export const PERMIT_PENDING_WHERE: Prisma.CodeViolationCaseWhereInput = {
  OR: [
    { workflow: { permitStatus: "UNDETERMINED" } },
    { workflow: { permitStatus: "REQUIRED" }, NOT: { job: { permits: { some: { status: { in: [...PERMIT_ISSUED_STATUSES] } } } } } },
  ],
};

export function buildViolationListWhere(p: ViolationListParams, ctx: ViolationListContext): Prisma.CodeViolationCaseWhereInput {
  const and: Prisma.CodeViolationCaseWhereInput[] = [];
  const now = ctx.now;
  const open: Prisma.CodeViolationCaseWhereInput = { status: { in: [...OPEN_CASE_STATUSES] } };

  // The queue.
  switch (p.view) {
    case "all":
      if (!p.status) and.push(open);
      break;
    case "mine":
      and.push(open, {
        OR: [
          { caseManagerId: ctx.user.id },
          { items: { some: { assignedUserId: ctx.user.id } } },
          { tasks: { some: { assignedUserId: ctx.user.id, ...ACTIVE_OPEN_WHERE } } },
          { workflow: { team: { some: { userId: ctx.user.id } } } },
        ],
      });
      break;
    case "new":
      and.push({ status: "NEW" });
      break;
    case "due-soon": {
      const until = new Date(now.getTime() + p.withinDays * 86_400_000);
      and.push(open, { agencyConfirmedAt: null, currentDeadline: { gte: now, lte: until } });
      break;
    }
    case "overdue":
      and.push(open, { agencyConfirmedAt: null, currentDeadline: { lt: now } });
      break;
    case "fines":
      and.push(open, { OR: [finesAccruingWhere(now), { lienStatus: "RECORDED" }, { officialBalance: { gt: 0 }, fineResolvedAt: null }] });
      break;
    case "awaiting-agency":
      and.push(open, AWAITING_AGENCY_WHERE);
      break;
    case "closed":
      and.push({ status: { in: ["CLOSED", "CANCELLED"] } });
      break;
  }

  if (p.status) and.push({ status: p.status });
  if (p.leadId) and.push({ leadId: p.leadId });
  if (p.jobId) and.push({ jobId: p.jobId });
  if (p.unlinked) and.push({ jobId: null });
  if (p.jurisdiction) and.push({ jurisdiction: { equals: p.jurisdiction, mode: "insensitive" } });
  if (p.categoryId) and.push({ items: { some: { categoryId: p.categoryId } } });
  if (p.caseManagerId) and.push(p.caseManagerId === "__unassigned" ? { caseManagerId: null } : { caseManagerId: p.caseManagerId });
  if (p.phaseKey) and.push({ tasks: { some: { workflowTaskKey: { not: null }, workflowPhaseKey: p.phaseKey, ...ACTIVE_OPEN_WHERE } } });
  if (p.search) {
    const q = p.search;
    and.push({
      OR: [
        { caseNumber: { contains: q, mode: "insensitive" } },
        { agencyCaseNumber: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { parcelNumber: { contains: q, mode: "insensitive" } },
        { ownerNameSnapshot: { contains: q, mode: "insensitive" } },
        { jurisdiction: { contains: q, mode: "insensitive" } },
        { lead: { OR: [{ propertyAddress1: { contains: q, mode: "insensitive" } }, { fullName: { contains: q, mode: "insensitive" } }] } },
      ],
    });
  }

  const f = p.flags;
  if (f.finesAccruing) and.push(finesAccruingWhere(now));
  if (f.lienRecorded) and.push({ lienStatus: "RECORDED" });
  if (f.hearingScheduled) and.push({ nextHearingAt: { gte: now } });
  if (f.permitPending) and.push(PERMIT_PENDING_WHERE);
  if (f.emergency) and.push({ emergency: true });
  if (f.constructionRequired) and.push({ constructionRequired: true });
  if (f.blocked) and.push({ tasks: { some: { workflowTaskKey: { not: null }, status: "BLOCKED" } } });

  // The role scope, always last and always present.
  and.push(violationVisibilityFilter(ctx.user));
  return { AND: and };
}

// ── Hearings / inspections schedule lists ──

export type ScheduleStatusFilter = "upcoming" | "pending" | "completed" | "all";

export type ScheduleParams = {
  from?: Date;
  to?: Date;
  status: ScheduleStatusFilter;
  jurisdiction?: string;
  assignedUserId?: string;
};

export function parseScheduleParams(sp: URLSearchParams): ScheduleParams {
  const s = sp.get("status");
  const status: ScheduleStatusFilter = s === "pending" || s === "completed" || s === "all" ? s : "upcoming";
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00.000Z`) : undefined);
  return {
    from: date(sp.get("from")),
    to: date(sp.get("to")),
    status,
    jurisdiction: sp.get("jurisdiction")?.trim() || undefined,
    assignedUserId: sp.get("assignedUserId") || undefined,
  };
}

export function buildHearingWhere(p: ScheduleParams, ctx: ViolationListContext): Prisma.CodeViolationHearingWhereInput {
  const and: Prisma.CodeViolationHearingWhereInput[] = [];
  if (p.status === "upcoming") and.push({ status: { in: ["SCHEDULED", "CONTINUED"] }, scheduledAt: { gte: startOfToday(ctx.now) } });
  if (p.status === "pending") and.push({ status: { in: ["SCHEDULED", "CONTINUED", "HELD"] }, outcome: null });
  if (p.status === "completed") and.push({ status: "HELD" });
  if (p.from) and.push({ scheduledAt: { gte: p.from } });
  if (p.to) and.push({ scheduledAt: { lte: endOfDay(p.to) } });
  if (p.assignedUserId) and.push({ attendeeUserId: p.assignedUserId });
  const caseWhere: Prisma.CodeViolationCaseWhereInput = { AND: [violationVisibilityFilter(ctx.user), ...(p.jurisdiction ? [{ jurisdiction: { equals: p.jurisdiction, mode: "insensitive" as const } }] : [])] };
  and.push({ case: caseWhere });
  return { AND: and };
}

export function buildInspectionWhere(p: ScheduleParams, ctx: ViolationListContext): Prisma.CodeViolationInspectionWhereInput {
  const and: Prisma.CodeViolationInspectionWhereInput[] = [];
  if (p.status === "upcoming") and.push({ status: { in: ["REQUESTED", "SCHEDULED"] } });
  if (p.status === "pending") and.push({ status: { in: ["REQUESTED", "SCHEDULED"] }, result: null });
  if (p.status === "completed") and.push({ status: "COMPLETED" });
  if (p.from) and.push({ OR: [{ scheduledFor: { gte: p.from } }, { scheduledFor: null, requestedAt: { gte: p.from } }] });
  if (p.to) and.push({ OR: [{ scheduledFor: { lte: endOfDay(p.to) } }, { scheduledFor: null, requestedAt: { lte: endOfDay(p.to) } }] });
  if (p.assignedUserId) and.push({ attendeeUserId: p.assignedUserId });
  const caseWhere: Prisma.CodeViolationCaseWhereInput = { AND: [violationVisibilityFilter(ctx.user), ...(p.jurisdiction ? [{ jurisdiction: { equals: p.jurisdiction, mode: "insensitive" as const } }] : [])] };
  and.push({ case: caseWhere });
  return { AND: and };
}

function startOfToday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
