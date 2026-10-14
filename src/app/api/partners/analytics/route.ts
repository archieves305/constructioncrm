import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { toCsv } from "@/lib/csv";
import { canViewPartnerMoney } from "@/lib/partners/access";
import { loadAnalytics, type AnalyticsGroupBy } from "@/lib/partners/scorecard-load";
import { isPartnerStage } from "@/lib/partners/stages";
import { defaultPeriod, parseWindow, type Period } from "@/lib/partners/windows";
import { todayKey } from "@/lib/time/zone";

const GROUPS: readonly AnalyticsGroupBy[] = ["org", "trade", "market", "owner"];
const PERIODS: readonly Period[] = ["week", "month", "quarter", "year"];

/** Every account over a window, grouped; `?csv=1` answers the groups as a CSV file. Money roles only. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartnerMoney(session.user.role)) return NextResponse.json({ error: "Partner analytics show company financials" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const w = parseWindow(sp, todayKey());
  const by = (GROUPS as readonly string[]).includes(sp.get("groupBy") ?? "") ? (sp.get("groupBy") as AnalyticsGroupBy) : "org";
  const period = (PERIODS as readonly string[]).includes(sp.get("period") ?? "") ? (sp.get("period") as Period) : defaultPeriod(w);
  const stage = sp.get("stage");
  const data = await loadAnalytics(w, by, { stage: stage && isPartnerStage(stage) ? stage : null, market: sp.get("market") || null }, period);
  if (sp.get("csv") === "1") {
    const pct = (n: number | null) => (n === null ? "" : (n * 100).toFixed(1));
    const csv = toCsv(
      data.groups.map((g) => ({ group: g.label, invitations: g.kpis.invitations, submitted: g.kpis.submitted, awarded: g.kpis.awarded, lost: g.kpis.lost, winRate: pct(g.kpis.winRate), awardedValue: g.kpis.awardedValue, billed: g.kpis.billed, collected: g.kpis.collected, grossProfit: g.kpis.grossProfit ?? "", margin: pct(g.kpis.margin), daysToPay: g.kpis.daysToPay ?? "", unlinkedPayments: g.kpis.unlinkedPayments, jobs: g.kpis.jobs })),
      [
        { key: "group", header: by === "org" ? "Account" : by === "trade" ? "Trade" : by === "market" ? "Market" : "Owner" },
        { key: "invitations", header: "Invitations" },
        { key: "submitted", header: "Submitted" },
        { key: "awarded", header: "Awarded" },
        { key: "lost", header: "Lost" },
        { key: "winRate", header: "Win rate %" },
        { key: "awardedValue", header: "Awarded value" },
        { key: "billed", header: "Billed" },
        { key: "collected", header: "Collected" },
        { key: "grossProfit", header: "Projected gross profit" },
        { key: "margin", header: "Margin %" },
        { key: "daysToPay", header: "Days to pay" },
        { key: "unlinkedPayments", header: "Payments without an invoice" },
        { key: "jobs", header: "Jobs" },
      ],
    );
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="partner-analytics-${by}-${w.from}-to-${w.to}.csv"` } });
  }
  return NextResponse.json({ ...data, period });
}
