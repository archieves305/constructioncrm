import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canViewPayroll, getFieldGrants } from "@/lib/labor/permissions";
import { fromDbDate, isIsoDate, toDbDate, weekStartOf } from "@/lib/labor/dates";
import { getLaborSettings } from "@/lib/labor/settings";

// Cross-job field-labor report: hours/cost grouped by worker, trade, job,
// and week over a date range. Payroll-level data — explicit role list +
// grant, never hasMinRole.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const grants = await getFieldGrants(session.user.id);
  if (!canViewPayroll(session.user.role, grants)) return forbidden();

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = { isAbsent: false };
  const dateFilter: Record<string, Date> = {};
  if (from && isIsoDate(from)) dateFilter.gte = toDbDate(from);
  if (to && isIsoDate(to)) dateFilter.lte = toDbDate(to);
  if (Object.keys(dateFilter).length) where.workDate = dateFilter;

  const [entries, settings] = await Promise.all([
    prisma.dailyLaborEntry.findMany({
      where,
      select: {
        workDate: true,
        personnelId: true,
        trade: true,
        jobId: true,
        totalHours: true,
        regularHours: true,
        otHours: true,
        totalCost: true,
        personnel: {
          select: { firstName: true, lastName: true, employmentType: true },
        },
        job: { select: { jobNumber: true, title: true } },
      },
      orderBy: { workDate: "asc" },
    }),
    getLaborSettings(),
  ]);

  type Bucket = {
    key: string;
    label: string;
    hours: number;
    regularHours: number;
    otHours: number;
    cost: number;
    days: Set<string>;
  };
  const groups: Record<string, Map<string, Bucket>> = {
    byWorker: new Map(),
    byTrade: new Map(),
    byJob: new Map(),
    byWeek: new Map(),
  };
  const totals = { hours: 0, regularHours: 0, otHours: 0, cost: 0 };

  const bucket = (map: Map<string, Bucket>, key: string, label: string) => {
    let b = map.get(key);
    if (!b) {
      b = { key, label, hours: 0, regularHours: 0, otHours: 0, cost: 0, days: new Set() };
      map.set(key, b);
    }
    return b;
  };

  for (const e of entries) {
    const date = fromDbDate(e.workDate);
    const targets = [
      bucket(
        groups.byWorker,
        e.personnelId,
        `${e.personnel.lastName}, ${e.personnel.firstName}`,
      ),
      bucket(groups.byTrade, e.trade ?? "unassigned", e.trade ?? "Unassigned"),
      bucket(groups.byJob, e.jobId, `${e.job.jobNumber} — ${e.job.title}`),
      bucket(
        groups.byWeek,
        weekStartOf(date, settings.weekStartsOn),
        `Week of ${weekStartOf(date, settings.weekStartsOn)}`,
      ),
    ];
    for (const b of targets) {
      b.hours += Number(e.totalHours);
      b.regularHours += Number(e.regularHours);
      b.otHours += Number(e.otHours);
      b.cost += Number(e.totalCost);
      b.days.add(date);
    }
    totals.hours += Number(e.totalHours);
    totals.regularHours += Number(e.regularHours);
    totals.otHours += Number(e.otHours);
    totals.cost += Number(e.totalCost);
  }

  const shape = (b: Bucket) => ({
    key: b.key,
    label: b.label,
    hours: round2(b.hours),
    regularHours: round2(b.regularHours),
    otHours: round2(b.otHours),
    cost: round2(b.cost),
    daysWorked: b.days.size,
  });

  return NextResponse.json({
    totals: {
      hours: round2(totals.hours),
      regularHours: round2(totals.regularHours),
      otHours: round2(totals.otHours),
      cost: round2(totals.cost),
    },
    byWorker: [...groups.byWorker.values()].map(shape).sort((a, b) => b.hours - a.hours),
    byTrade: [...groups.byTrade.values()].map(shape).sort((a, b) => b.hours - a.hours),
    byJob: [...groups.byJob.values()].map(shape).sort((a, b) => b.hours - a.hours),
    byWeek: [...groups.byWeek.values()].map(shape).sort((a, b) => a.key.localeCompare(b.key)),
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
