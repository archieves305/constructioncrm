import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobAccessWhere, leadAccessWhere } from "@/lib/access/records";
import { overdueWhere } from "@/lib/calendar/status";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { caseLabel, formatAddressLine, jobLabel, customerName, type EntityLabel } from "@/lib/labels";
import { CASE_LABEL_SELECT, JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import type { ListScope } from "@/lib/lists/scope";
import { dashboardTaskWhere } from "@/lib/reports/dashboard-scope";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { RESUBMIT_DUE_DAYS, BIDS_DUE_DAYS } from "./rows";

/** A prequalification this close to its expiry is on the list. */
const QUALIFICATION_EXPIRING_DAYS = 90;
/** A vault document this close to its expiry — the same window the vault alerts use. */
const VAULT_EXPIRING_DAYS = 30;
import { APP_TIME_ZONE, dayKey } from "@/lib/time/zone";
import { vendorsNeedingDocuments } from "@/lib/vendors/compliance-load";
import { violationVisibilityFilter } from "@/lib/violations/access";
import { OPEN_CASE_STATUSES } from "@/lib/violations/rules";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import {
  ATTENTION_LIST_LIMIT,
  PERMIT_EXPIRING_DAYS,
  PERMIT_WAITING_DAYS,
  QUIET_JOB_DAYS,
  VIOLATION_DEADLINE_DAYS,
  attentionHref,
  attentionRow,
  attentionRowsFor,
  type AttentionCount,
  type AttentionItem,
  type AttentionKey,
  type AttentionList,
} from "./rows";

/**
 * The queries behind the dashboard's "Needs attention" block. Each row has
 * one `where`; its count and its list are both read through it.
 *
 * Scope: Mine narrows job-shaped rows to jobs the person has a role on, lead
 * rows to their leads and case rows to cases they are on. All still passes
 * through the by-id access rule, so nobody is counted a record they could
 * not open.
 */

export type AttentionContext = { user: { id: string; role: RoleName }; scope: ListScope; now: Date };

const DAY = 86_400_000;
const OPEN_JOB: Prisma.JobWhereInput = { currentStage: { isClosed: false } };

function jobScope(ctx: AttentionContext): Prisma.JobWhereInput {
  return ctx.scope === "mine" ? jobsInvolvingUserWhere(ctx.user.id) : jobAccessWhere(ctx.user);
}
const openJobInScope = (ctx: AttentionContext): Prisma.JobWhereInput => ({ AND: [OPEN_JOB, jobScope(ctx)] });

// ── One `where` per row ─────────────────────────────────────────────────────

/** The engine's account follow-ups still open; Mine = assigned to me. */
export function partnerFollowUpsWhere(ctx: AttentionContext): Prisma.TaskWhereInput {
  return {
    AND: [
      { organizationId: { not: null }, sourceKey: { startsWith: "org:" }, status: { in: [...OPEN_TASK_STATUSES] }, activatedAt: { not: null } },
      dashboardTaskWhere({ scope: ctx.scope, userId: ctx.user.id }),
    ],
  };
}

/** Open bids due inside the window or past due, not yet submitted; Mine = I estimate it or own the account. */
export function bidsDueWhere(ctx: AttentionContext): Prisma.BidInvitationWhereInput {
  const soon = new Date(ctx.now.getTime() + BIDS_DUE_DAYS * 86_400_000);
  return {
    AND: [
      { status: { in: ["TRACKING", "INVITED", "DECIDING", "ESTIMATING"] }, bidDueAt: { lte: soon }, lead: leadAccessWhere(ctx.user) },
      ctx.scope === "mine" ? { OR: [{ estimatorUserId: ctx.user.id }, { organization: { ownerUserId: ctx.user.id } }] } : {},
    ],
  };
}

/** Invitations with no go / no-go yet. */
export function bidsAwaitingDecisionWhere(ctx: AttentionContext): Prisma.BidInvitationWhereInput {
  return { AND: [{ status: { in: ["INVITED", "DECIDING"] }, decision: "UNDECIDED", lead: leadAccessWhere(ctx.user) }, ctx.scope === "mine" ? { OR: [{ estimatorUserId: ctx.user.id }, { organization: { ownerUserId: ctx.user.id } }] } : {}] };
}

/** Approved prequalifications expired, renewal-due, or expiring inside 90 days; Mine = accounts I own. */
export function qualificationsExpiringWhere(ctx: AttentionContext): Prisma.QualificationWhereInput {
  const soon = new Date(ctx.now.getTime() + QUALIFICATION_EXPIRING_DAYS * 86_400_000);
  return {
    AND: [
      { status: "APPROVED", organization: { isActive: true }, OR: [{ expiresAt: { lte: soon } }, { renewalDueAt: { lte: ctx.now } }] },
      ctx.scope === "mine" ? { organization: { ownerUserId: ctx.user.id } } : {},
    ],
  };
}

export function overdueTasksWhere(ctx: AttentionContext): Prisma.TaskWhereInput {
  return { AND: [overdueWhere(ctx.now), ACTIVE_OPEN_WHERE, dashboardTaskWhere({ scope: ctx.scope, userId: ctx.user.id })] };
}

/** A workflow inspection step blocked by a failed result, or the open correction task of an inspection no step carried. */
export function inspectionsToCorrectWhere(ctx: AttentionContext): Prisma.TaskWhereInput {
  return {
    job: jobScope(ctx),
    OR: [
      { workflowTaskKey: { not: null }, status: "BLOCKED", inspectionResult: "FAIL" },
      { sourceKey: { startsWith: "permit-inspection:", endsWith: ":correction" }, status: { in: [...OPEN_TASK_STATUSES] } },
    ],
  };
}

export function violationDeadlinesWhere(ctx: AttentionContext): Prisma.CodeViolationCaseWhereInput {
  const until = new Date(ctx.now.getTime() + VIOLATION_DEADLINE_DAYS * DAY);
  const me = ctx.user.id;
  const mine: Prisma.CodeViolationCaseWhereInput = {
    OR: [
      { caseManagerId: me },
      { items: { some: { assignedUserId: me } } },
      { tasks: { some: { assignedUserId: me, ...ACTIVE_OPEN_WHERE } } },
      { workflow: { team: { some: { userId: me } } } },
    ],
  };
  return {
    AND: [
      { status: { in: [...OPEN_CASE_STATUSES] }, agencyConfirmedAt: null, currentDeadline: { lte: until } },
      violationVisibilityFilter(ctx.user),
      ctx.scope === "mine" ? mine : {},
    ],
  };
}

export function permitsExpiringWhere(ctx: AttentionContext): Prisma.JobPermitWhereInput {
  const until = new Date(ctx.now.getTime() + PERMIT_EXPIRING_DAYS * DAY);
  return {
    job: openJobInScope(ctx),
    OR: [{ status: "EXPIRED" }, { status: { in: ["ISSUED", "IN_PROGRESS"] }, expirationDate: { lte: until } }],
  };
}

export function permitsWaitingWhere(ctx: AttentionContext): Prisma.JobPermitWhereInput {
  const since = new Date(ctx.now.getTime() - PERMIT_WAITING_DAYS * DAY);
  return { job: openJobInScope(ctx), status: { in: ["APPLIED", "IN_PROGRESS"] }, approvedDate: null, submittedDate: { lt: since } };
}

export function permitCorrectionsWhere(ctx: AttentionContext): Prisma.JobPermitWhereInput {
  return { job: openJobInScope(ctx), status: "CORRECTIONS" };
}

export function permitResubmitDueWhere(ctx: AttentionContext): Prisma.JobPermitWhereInput {
  const until = new Date(ctx.now.getTime() + RESUBMIT_DUE_DAYS * DAY);
  return { job: openJobInScope(ctx), status: "CORRECTIONS", correctionNotices: { some: { status: "CONFIRMED", responseDueAt: { lte: until } } } };
}

export function overdueFollowUpsWhere(ctx: AttentionContext): Prisma.LeadWhereInput {
  return {
    AND: [
      { kind: "CUSTOMER", nextFollowUpAt: { lt: ctx.now }, currentStage: { isClosed: false } },
      ctx.scope === "mine" ? leadsInvolvingUserWhere(ctx.user.id) : leadAccessWhere(ctx.user),
    ],
  };
}

export function changeOrdersAwaitingWhere(ctx: AttentionContext): Prisma.ChangeOrderWhereInput {
  return { status: "SENT", job: jobScope(ctx) };
}

export function contractsAwaitingWhere(ctx: AttentionContext): Prisma.CustomerContractWhereInput {
  return { status: "SENT", job: jobScope(ctx) };
}

export function pendingExpensesWhere(ctx: AttentionContext): Prisma.JobExpenseWhereInput {
  return { status: "PENDING", job: jobScope(ctx) };
}

export function logsAwaitingWhere(ctx: AttentionContext): Prisma.DailyLogWhereInput {
  return { status: "SUBMITTED", job: jobScope(ctx) };
}

export function depositsMissingWhere(ctx: AttentionContext): Prisma.JobWhereInput {
  return { AND: [OPEN_JOB, jobScope(ctx), { depositRequired: { gt: 0 }, depositReceived: { lt: prisma.job.fields.depositRequired } }] };
}

export function quietJobsWhere(ctx: AttentionContext): Prisma.JobWhereInput {
  const since = new Date(ctx.now.getTime() - QUIET_JOB_DAYS * DAY);
  return {
    AND: [
      OPEN_JOB,
      jobScope(ctx),
      {
        updatedAt: { lt: since },
        stageHistory: { none: { changedAt: { gte: since } } },
        tasks: { none: { updatedAt: { gte: since } } },
        dailyLogs: { none: { updatedAt: { gte: since } } },
        payments: { none: { createdAt: { gte: since } } },
        expenses: { none: { createdAt: { gte: since } } },
      },
    ],
  };
}

// ── Counts ──────────────────────────────────────────────────────────────────

const COUNTERS: Record<AttentionKey, (ctx: AttentionContext) => Promise<number>> = {
  "overdue-tasks": (ctx) => prisma.task.count({ where: overdueTasksWhere(ctx) }),
  "inspections-to-correct": (ctx) => prisma.task.count({ where: inspectionsToCorrectWhere(ctx) }),
  "violation-deadlines": (ctx) => prisma.codeViolationCase.count({ where: violationDeadlinesWhere(ctx) }),
  "permits-expiring": (ctx) => prisma.jobPermit.count({ where: permitsExpiringWhere(ctx) }),
  "permits-waiting": (ctx) => prisma.jobPermit.count({ where: permitsWaitingWhere(ctx) }),
  "permit-corrections": (ctx) => prisma.jobPermit.count({ where: permitCorrectionsWhere(ctx) }),
  "permit-resubmit-due": (ctx) => prisma.jobPermit.count({ where: permitResubmitDueWhere(ctx) }),
  // Company-wide, so Mine and All agree: a vendor belongs to no one job.
  "vendor-compliance": async (ctx) => (await vendorsNeedingDocuments(dayKey(ctx.now))).length,
  "overdue-follow-ups": (ctx) => prisma.lead.count({ where: overdueFollowUpsWhere(ctx) }),
  "change-orders-awaiting": (ctx) => prisma.changeOrder.count({ where: changeOrdersAwaitingWhere(ctx) }),
  "contracts-awaiting": (ctx) => prisma.customerContract.count({ where: contractsAwaitingWhere(ctx) }),
  "pending-expenses": (ctx) => prisma.jobExpense.count({ where: pendingExpensesWhere(ctx) }),
  "logs-awaiting": (ctx) => prisma.dailyLog.count({ where: logsAwaitingWhere(ctx) }),
  "deposits-missing": (ctx) => prisma.job.count({ where: depositsMissingWhere(ctx) }),
  "quiet-jobs": (ctx) => prisma.job.count({ where: quietJobsWhere(ctx) }),
  "partner-follow-ups": (ctx) => prisma.task.count({ where: partnerFollowUpsWhere(ctx) }),
  "qualifications-expiring": (ctx) => prisma.qualification.count({ where: qualificationsExpiringWhere(ctx) }),
  // Company-wide, so Mine and All agree: the vault belongs to no one account.
  "company-docs-expiring": async (ctx) => (await expiringVaultDocuments(ctx.now)).length,
  "bids-due": (ctx) => prisma.bidInvitation.count({ where: bidsDueWhere(ctx) }),
  "bids-awaiting-decision": (ctx) => prisma.bidInvitation.count({ where: bidsAwaitingDecisionWhere(ctx) }),
};

/** The current version of each document type that has expired or expires inside 30 days. */
async function expiringVaultDocuments(now: Date) {
  const soon = new Date(now.getTime() + VAULT_EXPIRING_DAYS * 86_400_000);
  const docs = await prisma.companyDocument.findMany({ orderBy: [{ documentTypeId: "asc" }, { version: "desc" }], select: { id: true, title: true, documentTypeId: true, expiresAt: true, documentType: { select: { name: true } } } });
  const seen = new Set<string>();
  const out: typeof docs = [];
  for (const d of docs) {
    if (seen.has(d.documentTypeId)) continue;
    seen.add(d.documentTypeId);
    if (d.expiresAt && d.expiresAt <= soon) out.push(d);
  }
  return out.sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime());
}

/** Every row this person's role is shown, with its count (zeros included — the caller decides what to hide). */
export async function loadAttention(ctx: AttentionContext): Promise<AttentionCount[]> {
  const rows = attentionRowsFor(ctx.user.role);
  const counts = await Promise.all(rows.map((r) => COUNTERS[r.key](ctx)));
  return rows.map((r, i) => ({ key: r.key, label: r.label, tone: r.tone, count: counts[i], href: attentionHref(r.key, ctx.scope) }));
}

// ── Lists ───────────────────────────────────────────────────────────────────

const day = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: APP_TIME_ZONE }).format(d) : "";
/** Dates saved from a date picker are UTC pins: print the UTC day, not the office's evening before. */
const pinDay = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d) : "";
const money = (n: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n ?? 0));
const words = (s: string) => s.toLowerCase().replace(/_/g, " ");
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const take = ATTENTION_LIST_LIMIT;

function item(id: string, l: EntityLabel, detail: string, date: Date | null | undefined, href: string): AttentionItem {
  return { id, primary: l.primary, secondary: l.secondary, code: l.code, detail, date: iso(date), href };
}

function permitName(p: { permitType: string | null; permitNumber: string | null }): string {
  const what = p.permitType ? `${p.permitType} permit` : "Permit";
  return p.permitNumber ? `${what} #${p.permitNumber}` : what;
}

const LISTERS: Record<Exclude<AttentionKey, "overdue-tasks">, (ctx: AttentionContext) => Promise<AttentionItem[]>> = {
  "vendor-compliance": async (ctx) => {
    const rows = await vendorsNeedingDocuments(dayKey(ctx.now));
    return rows
      .slice(0, take)
      .map((v) => item(v.id, { primary: v.name, secondary: v.trade, code: null, placeholder: false }, v.compliance.gaps.join(" · "), null, `/vendors/${v.id}`));
  },
  "inspections-to-correct": async (ctx) => {
    const rows = await prisma.task.findMany({
      where: inspectionsToCorrectWhere(ctx),
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take,
      select: { id: true, title: true, dueAt: true, status: true, job: { select: JOB_LABEL_SELECT } },
    });
    return rows.map((t) =>
      item(t.id, jobLabel(t.job!), `${t.title}${t.status === "BLOCKED" ? " · step blocked until corrected" : ""}`, t.dueAt, `/jobs/${t.job!.id}?tab=permits`),
    );
  },
  "violation-deadlines": async (ctx) => {
    const rows = await prisma.codeViolationCase.findMany({
      where: violationDeadlinesWhere(ctx),
      orderBy: { currentDeadline: "asc" },
      take,
      select: { ...CASE_LABEL_SELECT, currentDeadline: true },
    });
    return rows.map((c) => {
      const past = c.currentDeadline! < ctx.now;
      return item(c.id, caseLabel(c), `${past ? "Deadline passed" : "Deadline"} ${day(c.currentDeadline)}`, c.currentDeadline, `/violations/${c.id}`);
    });
  },
  "permits-expiring": async (ctx) => {
    const rows = await prisma.jobPermit.findMany({
      where: permitsExpiringWhere(ctx),
      orderBy: { expirationDate: "asc" },
      take,
      select: { id: true, permitType: true, permitNumber: true, status: true, expirationDate: true, job: { select: JOB_LABEL_SELECT } },
    });
    return rows.map((p) => {
      const lapsed = p.status === "EXPIRED" || (p.expirationDate !== null && p.expirationDate < ctx.now);
      const when = p.expirationDate ? ` ${pinDay(p.expirationDate)}` : "";
      return item(p.id, jobLabel(p.job), `${permitName(p)} · ${lapsed ? "expired" : "expires"}${when}`, p.expirationDate, `/jobs/${p.job.id}?tab=permits`);
    });
  },
  "permits-waiting": async (ctx) => {
    const rows = await prisma.jobPermit.findMany({
      where: permitsWaitingWhere(ctx),
      orderBy: { submittedDate: "asc" },
      take,
      select: { id: true, permitType: true, permitNumber: true, submittedDate: true, municipality: true, job: { select: JOB_LABEL_SELECT } },
    });
    return rows.map((p) => {
      const days = Math.floor((ctx.now.getTime() - p.submittedDate!.getTime()) / DAY);
      const where = p.municipality ? ` · ${p.municipality}` : "";
      return item(p.id, jobLabel(p.job), `${permitName(p)}${where} · submitted ${pinDay(p.submittedDate)}, ${days} days ago`, p.submittedDate, `/jobs/${p.job.id}?tab=permits`);
    });
  },
  "permit-corrections": async (ctx) => {
    const rows = await prisma.jobPermit.findMany({
      where: permitCorrectionsWhere(ctx),
      orderBy: { updatedAt: "asc" },
      take,
      select: { id: true, permitType: true, permitNumber: true, municipality: true, updatedAt: true, job: { select: JOB_LABEL_SELECT }, correctionItems: { where: { status: { in: ["OPEN", "WAITING_THIRD_PARTY", "DISPUTED"] } }, select: { id: true } } },
    });
    return rows.map((p) => item(p.id, jobLabel(p.job), `${permitName(p)} · ${p.municipality} · ${p.correctionItems.length} correction${p.correctionItems.length === 1 ? "" : "s"} open`, p.updatedAt, `/permits/${p.id}?tab=corrections`));
  },
  "permit-resubmit-due": async (ctx) => {
    const rows = await prisma.jobPermit.findMany({
      where: permitResubmitDueWhere(ctx),
      take,
      select: { id: true, permitType: true, permitNumber: true, municipality: true, job: { select: JOB_LABEL_SELECT }, correctionNotices: { where: { status: "CONFIRMED" }, orderBy: { receivedAt: "desc" }, take: 1, select: { responseDueAt: true } } },
    });
    return rows
      .map((p) => ({ p, due: p.correctionNotices[0]?.responseDueAt ?? null }))
      .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0))
      .map(({ p, due }) => item(p.id, jobLabel(p.job), `${permitName(p)} · ${p.municipality} · corrected package due ${pinDay(due)}${due && due < ctx.now ? " (overdue)" : ""}`, due, `/permits/${p.id}?tab=corrections`));
  },
  "overdue-follow-ups": async (ctx) => {
    const rows = await prisma.lead.findMany({
      where: overdueFollowUpsWhere(ctx),
      orderBy: { nextFollowUpAt: "asc" },
      take,
      select: { ...LEAD_LABEL_SELECT, nextFollowUpAt: true, currentStage: { select: { name: true } } },
    });
    return rows.map((l) => {
      const name = customerName(l) || "Unnamed lead";
      const address = formatAddressLine(l);
      const label: EntityLabel = { primary: name, secondary: address || null, code: null, placeholder: false };
      return item(l.id, label, `${l.currentStage.name} · follow-up was due ${day(l.nextFollowUpAt)}`, l.nextFollowUpAt, `/leads/${l.id}`);
    });
  },
  "change-orders-awaiting": async (ctx) => {
    const rows = await prisma.changeOrder.findMany({
      where: changeOrdersAwaitingWhere(ctx),
      orderBy: { sentAt: "asc" },
      take,
      select: { id: true, number: true, title: true, customerPrice: true, sentAt: true, job: { select: JOB_LABEL_SELECT } },
    });
    return rows.map((co) =>
      item(
        co.id,
        jobLabel(co.job),
        `CO-${co.number}${co.title ? ` ${co.title}` : ""} · ${money(co.customerPrice)} · sent ${day(co.sentAt)}`,
        co.sentAt,
        `/jobs/${co.job.id}?tab=money&sub=change-orders`,
      ),
    );
  },
  "contracts-awaiting": async (ctx) => {
    const rows = await prisma.customerContract.findMany({
      where: contractsAwaitingWhere(ctx),
      orderBy: { sentAt: "asc" },
      take,
      select: { id: true, contractNumber: true, contractAmount: true, sentAt: true, job: { select: JOB_LABEL_SELECT } },
    });
    return rows.map((c) =>
      item(c.id, jobLabel(c.job), `${c.contractNumber} · ${money(c.contractAmount)} · sent ${day(c.sentAt)}`, c.sentAt, `/jobs/${c.job.id}?tab=money&sub=contract`),
    );
  },
  "pending-expenses": async (ctx) => {
    const rows = await prisma.jobExpense.findMany({
      where: pendingExpensesWhere(ctx),
      orderBy: { createdAt: "asc" },
      take,
      select: {
        id: true,
        type: true,
        vendor: true,
        amount: true,
        createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
        job: { select: JOB_LABEL_SELECT },
      },
    });
    return rows.map((e) =>
      item(
        e.id,
        jobLabel(e.job),
        `${money(e.amount)} · ${e.vendor?.trim() || words(e.type)} · entered by ${e.createdBy.firstName} ${e.createdBy.lastName} ${day(e.createdAt)}`,
        e.createdAt,
        `/jobs/${e.job.id}?tab=money&sub=expenses`,
      ),
    );
  },
  "logs-awaiting": async (ctx) => {
    const rows = await prisma.dailyLog.findMany({
      where: logsAwaitingWhere(ctx),
      orderBy: { logDate: "asc" },
      take,
      select: { id: true, logDate: true, submittedAt: true, job: { select: JOB_LABEL_SELECT } },
    });
    return rows.map((l) => {
      const ymd = l.logDate.toISOString().slice(0, 10);
      return item(l.id, jobLabel(l.job), `Log for ${pinDay(l.logDate)}${l.submittedAt ? ` · submitted ${day(l.submittedAt)}` : ""}`, l.logDate, `/jobs/${l.job.id}/daily-logs/${ymd}`);
    });
  },
  "deposits-missing": async (ctx) => {
    const rows = await prisma.job.findMany({
      where: depositsMissingWhere(ctx),
      orderBy: { createdAt: "asc" },
      take,
      select: { ...JOB_LABEL_SELECT, depositRequired: true, depositReceived: true, createdAt: true, currentStage: { select: { name: true } } },
    });
    return rows.map((j) =>
      item(
        j.id,
        jobLabel(j),
        `${money(Number(j.depositRequired) - Number(j.depositReceived))} still due of ${money(j.depositRequired)} · ${j.currentStage.name}`,
        null,
        `/jobs/${j.id}?tab=money`,
      ),
    );
  },
  "quiet-jobs": async (ctx) => {
    const rows = await prisma.job.findMany({
      where: quietJobsWhere(ctx),
      orderBy: { updatedAt: "asc" },
      take,
      select: { ...JOB_LABEL_SELECT, updatedAt: true, nextAction: true, currentStage: { select: { name: true } } },
    });
    return rows.map((j) =>
      item(j.id, jobLabel(j), `${j.currentStage.name} · last edited ${day(j.updatedAt)}${j.nextAction?.trim() ? ` · next: ${j.nextAction.trim()}` : ""}`, j.updatedAt, `/jobs/${j.id}`),
    );
  },
  "bids-due": async (ctx) => {
    const rows = await prisma.bidInvitation.findMany({ where: bidsDueWhere(ctx), orderBy: { bidDueAt: "asc" }, take, select: { id: true, leadId: true, number: true, projectName: true, bidDueAt: true, status: true, organization: { select: { name: true } } } });
    return rows.map((b) => item(b.id, { primary: `${b.organization.name} · ${b.projectName}`, secondary: words(b.status), code: b.number, placeholder: false }, b.bidDueAt && b.bidDueAt < ctx.now ? `was due ${day(b.bidDueAt)}` : `due ${day(b.bidDueAt)}`, b.bidDueAt, `/leads/${b.leadId}?tab=bid`));
  },
  "bids-awaiting-decision": async (ctx) => {
    const rows = await prisma.bidInvitation.findMany({ where: bidsAwaitingDecisionWhere(ctx), orderBy: [{ bidDueAt: { sort: "asc", nulls: "last" } }], take, select: { id: true, leadId: true, number: true, projectName: true, bidDueAt: true, invitedAt: true, organization: { select: { name: true } } } });
    return rows.map((b) => item(b.id, { primary: `${b.organization.name} · ${b.projectName}`, secondary: b.invitedAt ? `invited ${day(b.invitedAt)}` : null, code: b.number, placeholder: false }, b.bidDueAt ? `due ${day(b.bidDueAt)}` : "no due date", b.bidDueAt, `/leads/${b.leadId}?tab=bid`));
  },
  "qualifications-expiring": async (ctx) => {
    const rows = await prisma.qualification.findMany({
      where: qualificationsExpiringWhere(ctx),
      orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }],
      take,
      select: { id: true, platform: true, expiresAt: true, renewalDueAt: true, organization: { select: { id: true, name: true } } },
    });
    return rows.map((q) => {
      const expired = q.expiresAt && q.expiresAt < ctx.now;
      const detail = expired ? `expired ${day(q.expiresAt)}` : q.renewalDueAt && q.renewalDueAt <= ctx.now ? `renewal was due ${day(q.renewalDueAt)}` : `expires ${day(q.expiresAt)}`;
      return item(q.id, { primary: q.organization.name, secondary: q.platform, code: null, placeholder: false }, detail, q.expiresAt, `/partners/${q.organization.id}?tab=qualification`);
    });
  },
  "company-docs-expiring": async (ctx) => {
    const rows = await expiringVaultDocuments(ctx.now);
    return rows.slice(0, take).map((d) => item(d.id, { primary: d.documentType.name, secondary: d.title, code: null, placeholder: false }, d.expiresAt! < ctx.now ? `expired ${day(d.expiresAt)}` : `expires ${day(d.expiresAt)}`, d.expiresAt, "/partners/vault"));
  },
  "partner-follow-ups": async (ctx) => {
    const rows = await prisma.task.findMany({
      where: partnerFollowUpsWhere(ctx),
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take,
      select: { id: true, title: true, dueAt: true, organization: { select: { id: true, name: true, stage: true } }, assignedTo: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((t) =>
      item(
        t.id,
        { primary: t.organization?.name ?? t.title, secondary: t.title, code: null, placeholder: false },
        [t.dueAt ? `due ${day(t.dueAt)}` : null, t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : "unassigned"].filter(Boolean).join(" · "),
        t.dueAt,
        t.organization ? `/partners/${t.organization.id}` : `/tasks?task=${t.id}`,
      ),
    );
  },
};

/** One row's records. `count` is the full number even when the list is cut at the limit. */
export async function loadAttentionList(ctx: AttentionContext, key: Exclude<AttentionKey, "overdue-tasks">): Promise<AttentionList> {
  const def = attentionRow(key);
  const [count, items] = await Promise.all([COUNTERS[key](ctx), LISTERS[key](ctx)]);
  return { key, label: def.label, description: def.description, scope: ctx.scope, count, items };
}
