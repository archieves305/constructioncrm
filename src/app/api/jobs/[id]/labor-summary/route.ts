import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { canSeeLaborCosts } from "@/lib/labor/permissions";
import { fromDbDate, isIsoDate, toDbDate, weekStartOf } from "@/lib/labor/dates";
import { getLaborSettings } from "@/lib/labor/settings";

type Context = { params: Promise<{ id: string }> };

// Hours/cost roll-ups for one job's field labor. Costs are included only
// for cost-visible roles. (Budget-vs-actual and burn-rate projections are
// layered on in the financial-integration phase.)
export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;
  const withCost = canSeeLaborCosts(ctx.session.user.role);

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = { jobId, isAbsent: false };
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
        costCodeId: true,
        totalHours: true,
        regularHours: true,
        otHours: true,
        totalCost: true,
        personnel: { select: { firstName: true, lastName: true } },
        costCode: { select: { code: true, name: true } },
      },
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
  const mk = (key: string, label: string): Bucket => ({
    key,
    label,
    hours: 0,
    regularHours: 0,
    otHours: 0,
    cost: 0,
    days: new Set(),
  });

  const byWorker = new Map<string, Bucket>();
  const byTrade = new Map<string, Bucket>();
  const byCostCode = new Map<string, Bucket>();
  const byWeek = new Map<string, Bucket>();
  const totals = mk("total", "Total");

  for (const e of entries) {
    const date = fromDbDate(e.workDate);
    const week = weekStartOf(date, settings.weekStartsOn);
    const buckets = [
      totals,
      upsert(byWorker, e.personnelId, `${e.personnel.firstName} ${e.personnel.lastName}`),
      upsert(byTrade, e.trade ?? "unassigned", e.trade ?? "Unassigned"),
      upsert(
        byCostCode,
        e.costCodeId ?? "none",
        e.costCode ? `${e.costCode.code} — ${e.costCode.name}` : "No cost code",
      ),
      upsert(byWeek, week, `Week of ${week}`),
    ];
    for (const b of buckets) {
      b.hours += Number(e.totalHours);
      b.regularHours += Number(e.regularHours);
      b.otHours += Number(e.otHours);
      b.cost += Number(e.totalCost);
      b.days.add(date);
    }
  }

  function upsert(map: Map<string, Bucket>, key: string, label: string): Bucket {
    let b = map.get(key);
    if (!b) {
      b = mk(key, label);
      map.set(key, b);
    }
    return b;
  }

  const shape = (b: Bucket) => ({
    key: b.key,
    label: b.label,
    hours: round2(b.hours),
    regularHours: round2(b.regularHours),
    otHours: round2(b.otHours),
    daysWorked: b.days.size,
    ...(withCost ? { cost: round2(b.cost) } : {}),
  });

  return NextResponse.json({
    totals: shape(totals),
    byWorker: [...byWorker.values()].map(shape).sort((a, b) => b.hours - a.hours),
    byTrade: [...byTrade.values()].map(shape).sort((a, b) => b.hours - a.hours),
    byCostCode: [...byCostCode.values()].map(shape).sort((a, b) => b.hours - a.hours),
    byWeek: [...byWeek.values()]
      .map(shape)
      .sort((a, b) => a.key.localeCompare(b.key)),
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
