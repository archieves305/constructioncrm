"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  Trophy,
  XCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
} from "lucide-react";
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
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6",
];

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetch("/api/reports?type=dashboard").then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Lead intelligence overview" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Dashboard" description="Lead intelligence overview" />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          title="Total Leads"
          value={data?.totalLeads || 0}
          icon={Users}
        />
        <KpiCard
          title="Won"
          value={data?.wonCount || 0}
          icon={Trophy}
        />
        <KpiCard
          title="Lost"
          value={data?.lostCount || 0}
          icon={XCircle}
        />
        <KpiCard
          title="Close Rate"
          value={`${data?.closeRate || 0}%`}
          icon={TrendingUp}
        />
        <KpiCard
          title="Overdue Follow-Ups"
          value={data?.overdueFollowUps || 0}
          icon={AlertTriangle}
        />
        <KpiCard
          title="Overdue Tasks"
          value={data?.overdueTasks || 0}
          icon={Clock}
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
                  <XAxis dataKey="stageName" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
            <CardTitle className="text-base">Leads by Salesperson</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.byRep?.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.byRep} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="userName" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
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
    </div>
  );
}
