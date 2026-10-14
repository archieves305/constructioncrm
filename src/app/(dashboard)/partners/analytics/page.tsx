"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, BadgeDollarSign, Clock, Download, Gavel, PiggyBank, Receipt, Trophy } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HttpError } from "@/lib/fetch-json";
import { useAnalytics, type Analytics } from "@/components/partners/use-partners";

type Preset = "30d" | "90d" | "12m" | "ytd" | "last-year" | "custom";
type By = "org" | "trade" | "market" | "owner";
type Period = "week" | "month" | "quarter" | "year";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const BY_LABEL: Record<By, string> = { org: "GC", trade: "Trade", market: "Market", owner: "Owner" };

export default function PartnerAnalyticsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <PartnerAnalytics />
    </Suspense>
  );
}

function PartnerAnalytics() {
  const url = useSearchParamState();
  const preset = (["30d", "90d", "12m", "ytd", "last-year", "custom"].includes(url.get("preset") ?? "") ? url.get("preset") : "12m") as Preset;
  const by = (["org", "trade", "market", "owner"].includes(url.get("groupBy") ?? "") ? url.get("groupBy") : "org") as By;
  const period = (["week", "month", "quarter", "year"].includes(url.get("period") ?? "") ? url.get("period") : null) as Period | null;
  const [from, setFrom] = useState(url.get("from") ?? "");
  const [to, setTo] = useState(url.get("to") ?? "");
  const qs = useMemo(() => {
    const p = new URLSearchParams({ preset, groupBy: by });
    if (preset === "custom") {
      p.set("from", url.get("from") ?? "");
      p.set("to", url.get("to") ?? "");
    }
    if (period) p.set("period", period);
    return p.toString();
  }, [preset, by, period, url]);
  const data = useAnalytics(qs);
  const denied = data.error instanceof HttpError && data.error.status === 403;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Partner analytics"
        breadcrumb={[{ label: "Business Development" }, { label: "Analytics" }]}
        description="Which GCs bring work worth having: bids, wins, revenue, profit and how fast they pay."
        actions={!denied && <Button variant="outline" size="sm" render={<a href={`/api/partners/analytics?${qs}&csv=1`} />} nativeButton={false}><Download className="mr-1.5 size-4" /> CSV</Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<Preset>
          ariaLabel="Window"
          size="sm"
          value={preset}
          onValueChange={(v) => url.set("preset", v === "12m" ? null : v)}
          options={[
            { value: "30d", label: "30 d" },
            { value: "90d", label: "90 d" },
            { value: "12m", label: "12 mo" },
            { value: "ytd", label: "YTD" },
            { value: "last-year", label: "Last year" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {preset === "custom" && (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); url.set("from", from || null); url.set("to", to || null); }}>
            <Input type="date" aria-label="From" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={!from || !to}>Apply</Button>
          </form>
        )}
        <SegmentedControl<By> ariaLabel="Group by" size="sm" value={by} onValueChange={(v) => url.set("groupBy", v === "org" ? null : v)} options={(Object.keys(BY_LABEL) as By[]).map((k) => ({ value: k, label: `By ${BY_LABEL[k].toLowerCase()}` }))} />
        {data.data && <span className="text-xs text-muted-foreground">{data.data.window.from} – {data.data.window.to}</span>}
      </div>

      {denied ? (
        <EmptyState icon={BarChart3} title="Partner analytics are for office roles" description="They show revenue, profit and payment figures." />
      ) : data.isLoading ? (
        <ListSkeleton rows={6} />
      ) : data.isError || !data.data ? (
        <EmptyState icon={BarChart3} title="The analytics could not be loaded" description={(data.error as Error | null)?.message ?? ""} action={<Button variant="outline" onClick={() => data.refetch()}>Try again</Button>} />
      ) : (
        <Body a={data.data} by={by} onPeriod={(p) => url.set("period", p)} />
      )}
    </div>
  );
}

function Body({ a, by, onPeriod }: { a: Analytics; by: By; onPeriod: (p: Period) => void }) {
  const t = a.totals;
  const chart = a.groups.slice(0, 12).map((g) => ({ name: g.label.length > 22 ? `${g.label.slice(0, 21)}…` : g.label, Billed: Math.round(g.kpis.billed), "Gross profit": Math.round(g.kpis.grossProfit ?? 0), "Win rate": g.kpis.winRate == null ? 0 : Math.round(g.kpis.winRate * 100) }));
  const hasMoney = chart.some((c) => c.Billed || c["Gross profit"]);
  const hasWins = a.groups.some((g) => g.kpis.awarded + g.kpis.lost > 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard title="Invitations" value={t.invitations} icon={Gavel} description={`${t.submitted} submitted · bid rate ${pct(t.bidRate)}`} />
        <KpiCard title="Win rate" value={pct(t.winRate)} icon={Trophy} description={`${t.awarded} won · ${t.lost} lost`} />
        <KpiCard title="Awarded" value={usd(t.awardedValue)} icon={BadgeDollarSign} description={`${usd(t.openValue)} in play`} />
        <KpiCard title="Billed" value={usd(t.billed)} icon={Receipt} description={`${usd(t.collected)} collected`} />
        <KpiCard title="Projected profit" value={usd(t.grossProfit)} icon={PiggyBank} description={`${pct(t.margin)} margin`} />
        <KpiCard title="Days to pay" value={t.daysToPay == null ? "—" : Math.round(t.daysToPay)} icon={Clock} description={t.unlinkedPayments ? `${t.unlinkedPayments} without an invoice left out` : `${t.linkedPayments} measured`} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Pipeline</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {a.pipeline.byStage.map((s) => (
            <Link key={s.stage} href={`/partners?stage=${s.stage}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
              <span className="font-semibold tabular-nums">{s.count}</span> <span className="text-muted-foreground">{s.label}</span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {a.groups.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nothing to chart in this window" description={`No ${BY_LABEL[by].toLowerCase()} has a bid or a job here yet. Log bids from an account, or widen the window.`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Billed and projected profit by {BY_LABEL[by].toLowerCase()}</CardTitle></CardHeader>
            <CardContent>
              {hasMoney ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip formatter={(v) => usd(Number(v))} />
                    <Legend />
                    <Bar dataKey="Billed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Gross profit" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">Nothing billed in this window.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Win rate by {BY_LABEL[by].toLowerCase()}</CardTitle></CardHeader>
            <CardContent>
              {hasWins ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Bar dataKey="Win rate" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No bid was won or lost in this window.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {a.groups.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{BY_LABEL[by]}</TableHead>
                  <TableHead className="text-right">Invited</TableHead>
                  <TableHead className="text-right">Won / lost</TableHead>
                  <TableHead className="text-right">Awarded</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Days to pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.groups.map((g) => (
                  <TableRow key={g.key}>
                    <TableCell>{by === "org" ? <Link href={`/partners/${g.key}?tab=performance`} className="font-medium hover:underline">{g.label}</Link> : g.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.kpis.invitations}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.kpis.awarded} / {g.kpis.lost}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(g.kpis.awardedValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(g.kpis.billed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(g.kpis.margin)}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.kpis.daysToPay == null ? "—" : Math.round(g.kpis.daysToPay)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm">Business development activity</CardTitle>
          <SegmentedControl<Period> ariaLabel="Period" size="sm" value={a.period} onValueChange={onPeriod} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }]} />
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">New GCs</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead className="text-right">Outreach</TableHead>
                <TableHead className="text-right">Replies</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
                <TableHead className="text-right">Prequals sent / approved</TableHead>
                <TableHead className="text-right">Invited / submitted</TableHead>
                <TableHead className="text-right">Awards</TableHead>
                <TableHead className="text-right">Awarded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.bdKpis.map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="whitespace-nowrap">{p.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.newOrgs}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.contactsAdded}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.outreach}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.responses}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.meetings}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.qualsSubmitted} / {p.qualsApproved}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.invitations} / {p.submitted}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.awards}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(p.awardedRevenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
