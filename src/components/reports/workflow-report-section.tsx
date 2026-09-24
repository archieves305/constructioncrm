"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WorkflowReport, DurationStats } from "@/lib/workflows/reports";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { cn } from "@/lib/utils";
import { toneClasses } from "@/lib/ui/tones";

/**
 * The Workflow section of the reports page. One measure per chart, one hue
 * per series, hairline grid, rounded bar ends, a tooltip on every mark and a
 * table under every chart so no number lives in colour alone.
 */

// Validated categorical slots 1 and 2 (see the dataviz palette reference).
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const GRID = "#e5e7eb";
const TICK = { fontSize: 11, fill: "#52514e" } as const;

const fmtDays = (v: number | null) => (v === null ? "—" : `${v}d`);
const rowsHeight = (n: number) => Math.max(120, n * 30 + 48);

function BarPanel({
  title,
  description,
  data,
  nameKey,
  valueKey,
  valueLabel,
  children,
  empty,
}: {
  title: string;
  description?: string;
  data: Record<string, unknown>[];
  nameKey: string;
  valueKey: string;
  valueLabel: string;
  children?: React.ReactNode;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={rowsHeight(data.length)}>
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tick={TICK} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey={nameKey} width={150} tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  formatter={(v) => [String(v), valueLabel]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: GRID }}
                />
                <Bar dataKey={valueKey} name={valueLabel} fill={SERIES_1} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
            {children}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatsCells({ s }: { s: DurationStats }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{s.n}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtDays(s.avgDays)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtDays(s.medianDays)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtDays(s.p90Days)}</TableCell>
    </>
  );
}

const StatsHead = () => (
  <>
    <TableHead className="text-right">n</TableHead>
    <TableHead className="text-right">Avg</TableHead>
    <TableHead className="text-right">Median</TableHead>
    <TableHead className="text-right">p90</TableHead>
  </>
);

export function WorkflowReportSection({ report }: { report: WorkflowReport }) {
  const s = report.summary;
  const tiles = [
    { label: "Active workflows", value: s.active, href: "/jobs" },
    { label: "Open steps", value: s.stepsOpen, href: "/tasks?source=workflow" },
    { label: "Overdue", value: s.stepsOverdue, href: "/jobs?workflowOverdue=1", tone: "warning" as const },
    { label: "Blocked", value: s.stepsBlocked, href: "/jobs?workflowBlocked=1", tone: "danger" as const },
    { label: "Unassigned", value: s.stepsUnassigned, href: "/jobs?workflowUnassigned=1", tone: "neutral" as const },
    { label: "Permit undetermined", value: s.permitsUndetermined, href: "/jobs?permitStatus=UNDETERMINED", tone: "warning" as const },
  ];

  const tradeData = report.durationsByTrade.map((r) => ({ name: r.name, median: r.medianDays ?? 0 }));
  const phaseData = report.durationsByPhase.filter((r) => r.steps.n > 0).map((r) => ({ name: r.name, median: r.steps.medianDays ?? 0, key: r.key }));
  const roleData = report.overdueByRole.map((r) => ({ name: r.label, count: r.count }));
  const causeData = report.stalled.byCause.map((r) => ({ name: r.label, Blocked: r.blocked, Overdue: r.overdue }));

  return (
    <section id="workflow" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Workflow</h2>
        <p className="text-sm text-muted-foreground">
          {s.workflows} workflow{s.workflows === 1 ? "" : "s"}
          {report.range.from || report.range.to ? " applied in the selected range" : ""} · {s.completed} complete · durations in calendar days
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn("rounded-lg border bg-white px-4 py-3 hover:bg-gray-50", t.value > 0 && t.tone && toneClasses(t.tone).soft)}
          >
            <div className={cn("text-2xl font-semibold", t.value > 0 && t.tone && toneClasses(t.tone).text)}>{t.value}</div>
            <div className="text-xs text-muted-foreground">{t.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BarPanel
          title="Step time by trade"
          description="Median days a step stays active before it is done."
          data={tradeData}
          nameKey="name"
          valueKey="median"
          valueLabel="Median days"
          empty="No completed steps yet."
        >
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <StatsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.durationsByTrade.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.name}</TableCell>
                  <StatsCells s={r} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BarPanel>

        <BarPanel
          title="Step time by phase"
          description="Same measure, by phase in build order. The table adds whole-phase cycle time on jobs where the phase has closed (p90 in the CSV)."
          data={phaseData}
          nameKey="name"
          valueKey="median"
          valueLabel="Median days"
          empty="No completed steps yet."
        >
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Phase</TableHead>
                <TableHead className="text-right">Steps n</TableHead>
                <TableHead className="text-right">Step median</TableHead>
                <TableHead className="text-right">Cycle n</TableHead>
                <TableHead className="text-right">Cycle median</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.durationsByPhase.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    {r.name} <span className="text-xs text-muted-foreground">{r.moduleKey}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.steps.n}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDays(r.steps.medianDays)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.cycle.n}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDays(r.cycle.medianDays)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BarPanel>

        <BarPanel
          title="Overdue by role"
          description="Active steps past their due date, by the functional role the template assigned."
          data={roleData}
          nameKey="name"
          valueKey="count"
          valueLabel="Overdue steps"
          empty="Nothing is overdue."
        >
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Unassigned</TableHead>
                <TableHead className="text-right">Avg late</TableHead>
                <TableHead className="text-right">Oldest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.overdueByRole.map((r) => (
                <TableRow key={r.role}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.unassigned}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDays(r.avgDaysOverdue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDays(r.maxDaysOverdue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BarPanel>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stalled steps by cause</CardTitle>
            <CardDescription>Blocked steps and overdue active steps, classified: permits, inspections, payment, procurement, nobody assigned.</CardDescription>
          </CardHeader>
          <CardContent>
            {causeData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing is stalled.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={rowsHeight(causeData.length) + 24}>
                  <BarChart data={causeData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={8}>
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" tick={TICK} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={150} tick={TICK} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: GRID }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Blocked" stackId="a" fill={SERIES_2} barSize={14} stroke="#fff" strokeWidth={2} />
                    <Bar dataKey="Overdue" stackId="a" fill={SERIES_1} barSize={14} radius={[0, 4, 4, 0]} stroke="#fff" strokeWidth={2} />
                  </BarChart>
                </ResponsiveContainer>
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cause</TableHead>
                      <TableHead className="text-right">Blocked</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Jobs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.stalled.byCause.map((r) => (
                      <TableRow key={r.cause}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.blocked}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.overdue}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.jobs}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead times</CardTitle>
            <CardDescription>Median days between the milestones that decide a job&apos;s calendar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {report.leadTimes.overall.map((m) => (
                <div key={m.metric} className="rounded-lg border px-4 py-3">
                  <div className="text-2xl font-semibold">{m.medianDays === null ? "—" : `${m.medianDays}d`}</div>
                  <div className="text-xs text-muted-foreground">{m.label}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {m.n === 0 ? "no data yet" : `n ${m.n} · avg ${fmtDays(m.avgDays)} · p90 ${fmtDays(m.p90Days)}`}
                  </div>
                </div>
              ))}
            </div>
            {report.leadTimes.productionStartByTrade.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Applied → production start, by trade</TableHead>
                    <StatsHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.leadTimes.productionStartByTrade.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.name}</TableCell>
                      <StatsCells s={r} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Most-skipped steps</CardTitle>
            <CardDescription>Steps people skip by hand, ranked. Engine skips are re-plans (scope, permit branch), not choices.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.mostSkipped.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing has been skipped.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Engine</TableHead>
                    <TableHead>Last reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.mostSkipped.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <div className="text-sm">{r.title}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{r.key}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.userSkips}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.engineSkips}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground" title={r.lastReason ?? ""}>
                        {r.lastReason ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stalled steps</CardTitle>
            <CardDescription>The worst first: blocked, then longest overdue. Up to 25.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.stalled.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing is stalled.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Cause</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Days late</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.stalled.items.map((i) => (
                    <TableRow key={i.taskId}>
                      <TableCell>
                        <Link href={`/jobs/${i.jobId}?tab=workflow`} className="font-mono text-xs hover:underline">
                          {i.jobNumber}
                        </Link>
                        <div className="max-w-[180px] truncate text-xs text-muted-foreground">{i.jobTitle}</div>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm" title={i.title}>
                        {i.title}
                        {!i.assigned && <span className="ml-1 text-xs text-muted-foreground">(unassigned)</span>}
                      </TableCell>
                      <TableCell className="text-xs">{i.role ? WORKFLOW_ROLE_LABEL[i.role] : "—"}</TableCell>
                      <TableCell className="text-xs">{report.stalled.byCause.find((c) => c.cause === i.cause)?.label ?? i.cause}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", i.state === "BLOCKED" ? toneClasses("danger").pill : toneClasses("warning").pill)}>
                          {i.state === "BLOCKED" ? "Blocked" : "Overdue"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{i.daysOverdue === null ? "—" : i.daysOverdue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

/** CSV sections for the reports export. */
export function workflowCsvSections(report: WorkflowReport): { name: string; rows: Record<string, unknown>[] }[] {
  return [
    { name: "Workflow summary", rows: [report.summary as unknown as Record<string, unknown>] },
    { name: "Workflow step time by trade", rows: report.durationsByTrade.map(({ key, name, n, avgDays, medianDays, p90Days }) => ({ key, name, n, avgDays, medianDays, p90Days })) },
    {
      name: "Workflow step time by phase",
      rows: report.durationsByPhase.map((r) => ({
        key: r.key,
        name: r.name,
        module: r.moduleKey,
        band: r.band,
        stepN: r.steps.n,
        stepAvgDays: r.steps.avgDays,
        stepMedianDays: r.steps.medianDays,
        stepP90Days: r.steps.p90Days,
        cycleN: r.cycle.n,
        cycleAvgDays: r.cycle.avgDays,
        cycleMedianDays: r.cycle.medianDays,
        cycleP90Days: r.cycle.p90Days,
      })),
    },
    { name: "Workflow overdue by role", rows: report.overdueByRole.map(({ role, label, count, unassigned, avgDaysOverdue, maxDaysOverdue }) => ({ role, label, count, unassigned, avgDaysOverdue, maxDaysOverdue })) },
    { name: "Workflow stalled by cause", rows: report.stalled.byCause.map(({ cause, label, blocked, overdue, jobs }) => ({ cause, label, blocked, overdue, jobs })) },
    { name: "Workflow stalled steps", rows: report.stalled.items.map(({ jobNumber, jobTitle, title, role, cause, state, daysOverdue, assigned }) => ({ jobNumber, jobTitle, title, role, cause, state, daysOverdue, assigned })) },
    { name: "Workflow lead times", rows: report.leadTimes.overall.map(({ metric, label, n, avgDays, medianDays, p90Days }) => ({ metric, label, n, avgDays, medianDays, p90Days })) },
    { name: "Workflow production start by trade", rows: report.leadTimes.productionStartByTrade.map(({ key, name, n, avgDays, medianDays, p90Days }) => ({ key, name, n, avgDays, medianDays, p90Days })) },
    { name: "Workflow most-skipped steps", rows: report.mostSkipped.map(({ key, title, count, userSkips, engineSkips, lastReason }) => ({ key, title, count, userSkips, engineSkips, lastReason })) },
  ];
}
