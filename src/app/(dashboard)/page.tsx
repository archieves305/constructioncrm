"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MyTasksWidget } from "@/components/tasks/my-tasks-widget";
import { TodayWidget } from "@/components/calendar/today-widget";
import { WorkflowHealthWidget } from "@/components/dashboard/workflow-health-widget";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useListScope } from "@/components/shared/use-list-scope";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ListScope } from "@/lib/lists/scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Trophy, XCircle, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  type PieLabelRenderProps,
} from "recharts";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#6366f1",
  "#14b8a6",
];

export default function DashboardPage() {
  const { scope, setScope, forced, ready } = useListScope();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", scope],
    queryFn: () => fetchJson(`/api/reports?type=dashboard&scope=${scope}`),
    enabled: ready,
    retry: retryServerErrors,
  });
  const description =
    scope === "mine"
      ? "What needs you, then your day"
      : "What needs attention across the company";
  const scopeToggle = (
    <SegmentedControl<ListScope>
      ariaLabel="Scope"
      size="sm"
      value={scope}
      onValueChange={setScope}
      options={[
        { value: "mine", label: "Mine" },
        { value: "all", label: "All", disabled: forced },
      ]}
    />
  );

  if (!ready) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          description={description}
          actions={scopeToggle}
        />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={description}
        actions={scopeToggle}
      />

      <NeedsAttention scope={scope} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TodayWidget />
        <MyTasksWidget />
        <WorkflowHealthWidget className="lg:col-span-2" scope={scope} />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">
        Sales · {scope === "mine" ? "your leads" : "all leads"}
      </h2>
      {isLoading ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span className="text-muted-foreground">
              Couldn&apos;t load the sales numbers. Nothing is shown rather than
              zeros.
            </span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Total Leads"
              value={data?.totalLeads || 0}
              icon={Users}
              href={`/leads?scope=${scope}`}
            />
            <KpiCard title="Won" value={data?.wonCount || 0} icon={Trophy} />
            <KpiCard title="Lost" value={data?.lostCount || 0} icon={XCircle} />
            <KpiCard
              title="Close Rate"
              value={`${data?.closeRate || 0}%`}
              icon={TrendingUp}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Leads by Stage</CardTitle>
              </CardHeader>
              <CardContent>
                {data?.byStage?.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.byStage}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="stageName"
                        angle={-45}
                        textAnchor="end"
                        height={80}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No leads yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Leads by Source</CardTitle>
              </CardHeader>
              <CardContent>
                {data?.bySource?.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={data.bySource}
                        dataKey="count"
                        nameKey="sourceName"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={(props: PieLabelRenderProps) =>
                          `${props.name ?? ""} (${props.value ?? 0})`
                        }
                      >
                        {data.bySource.map((_: unknown, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No leads yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">
                  Leads by Salesperson
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data?.byRep?.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.byRep} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis
                        type="category"
                        dataKey="userName"
                        width={120}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        fill="#10b981"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No assigned leads yet
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
