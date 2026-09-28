import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { coerceUsersParam } from "@/lib/calendar/access";
import { compareDayItems } from "@/lib/calendar/agenda";
import { toCalendarItem } from "@/lib/calendar/items";
import { overlayItems, overlayScopes, type OverlayRows } from "@/lib/calendar/overlays";
import { buildCalendarWhere, CALENDAR_CAP, readCalendarParams, type CalendarParams } from "@/lib/calendar/query";
import { CALENDAR_ITEM_SELECT } from "@/lib/calendar/select";
import type { CalendarItem, CalendarRangeResponse } from "@/lib/calendar/types";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";
import type { UsersSelection } from "@/lib/calendar/access";
import type { VisibilityScope } from "@/lib/tasks/access";
import { APP_TIME_ZONE, endOfDayIn } from "@/lib/time/zone";

const CASE_SELECT = { id: true, caseNumber: true, agencyCaseNumber: true, leadId: true, lead: { select: LEAD_LABEL_SELECT } } as const;

/**
 * Read-only overlays for the same range: permit inspections, hearings, agency
 * inspections, job starts. Skipped when a task-shaped filter (status,
 * priority, search) is on — those questions are about work, not appointments.
 * A job filter narrows the job-based ones and drops the case-based ones.
 */
async function loadOverlays(params: CalendarParams, sel: UsersSelection, user: { id: string; role: "ADMIN" | "MANAGER" | "OFFICE_STAFF" | "SALES_REP" | "CREW_LEAD" | "MARKETING" | "READ_ONLY" }, scope: VisibilityScope | undefined, now: Date): Promise<CalendarItem[]> {
  if (params.status?.length || params.priority?.length || params.q) return [];
  // Date pickers store these as midnight UTC, which is the previous evening in
  // the office's zone — so the window opens at UTC midnight of the first day
  // and the mapped day key (see overlayWhen) is checked afterwards.
  const from = new Date(`${params.from}T00:00:00.000Z`);
  const to = endOfDayIn(params.to);
  const scopes = overlayScopes(sel, user, scope);
  const jobs = params.jobId ? { AND: [scopes.jobs, { id: params.jobId }] } : scopes.jobs;
  const [permitInspections, hearings, caseInspections, jobStarts] = await Promise.all([
    prisma.jobPermitInspection.findMany({
      where: { scheduledFor: { gte: from, lte: to }, permit: { job: jobs } },
      select: { id: true, type: true, scheduledFor: true, result: true, permit: { select: { id: true, permitType: true, permitNumber: true, job: { select: JOB_LABEL_SELECT } } } },
      take: 200,
    }),
    params.jobId
      ? []
      : prisma.codeViolationHearing.findMany({
          where: { scheduledAt: { gte: from, lte: to }, case: scopes.cases },
          select: { id: true, type: true, status: true, scheduledAt: true, location: true, case: { select: CASE_SELECT } },
          take: 200,
        }),
    params.jobId
      ? []
      : prisma.codeViolationInspection.findMany({
          where: { scheduledFor: { gte: from, lte: to }, case: scopes.cases },
          select: { id: true, status: true, scheduledFor: true, result: true, case: { select: CASE_SELECT } },
          take: 200,
        }),
    prisma.job.findMany({
      where: { AND: [jobs, { targetStartDate: { gte: from, lte: to }, currentStage: { isClosed: false } }] },
      select: { ...JOB_LABEL_SELECT, targetStartDate: true },
      take: 200,
    }),
  ]);
  const rows: OverlayRows = { permitInspections, hearings, caseInspections, jobStarts };
  return overlayItems(rows, now).filter((i) => i.dayKey !== null && i.dayKey >= params.from && i.dayKey <= params.to);
}

/**
 * Everything on the calendar between two days, for the people asked about.
 *
 * Thin on purpose: parse → coerce the people to what this role may see →
 * one `findMany` → normalise. Own-only roles always get their own calendar
 * whatever `users=` says, and the task visibility filter is applied on top.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = readCalendarParams(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);

  const now = new Date();
  const sel = coerceUsersParam(parsed.params.users, session.user.role);
  const scope = await visibilityScopeFor(session.user);
  const where = buildCalendarWhere(parsed.params, sel, session.user, scope);

  const [rows, overlays] = await Promise.all([
    prisma.task.findMany({
      where,
      select: CALENDAR_ITEM_SELECT,
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { id: "asc" }],
      take: CALENDAR_CAP + 1,
    }),
    loadOverlays(parsed.params, sel, session.user, scope, now),
  ]);

  const truncated = rows.length > CALENDAR_CAP;
  const tasks = (truncated ? rows.slice(0, CALENDAR_CAP) : rows).map((r) => toCalendarItem(r, now));
  const body: CalendarRangeResponse = {
    range: { from: parsed.params.from, to: parsed.params.to, timeZone: APP_TIME_ZONE },
    truncated,
    items: [...tasks, ...overlays.sort(compareDayItems)],
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
