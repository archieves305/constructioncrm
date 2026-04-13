"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Clock, Zap, Users, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

function formatSeconds(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function ResponseDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["response-times"],
    queryFn: () => fetch("/api/reports/response-times").then((r) => r.json()),
  });

  const slaBuckets = data?.slaBuckets;
  const slaChartData = slaBuckets
    ? [
        { name: "< 1 min", count: slaBuckets.under1, fill: "#22c55e" },
        { name: "1-5 min", count: slaBuckets.under5, fill: "#84cc16" },
        { name: "5-10 min", count: slaBuckets.under10, fill: "#f59e0b" },
        { name: "10-15 min", count: slaBuckets.under15, fill: "#f97316" },
        { name: "> 15 min", count: slaBuckets.over15, fill: "#ef4444" },
        { name: "No Response", count: slaBuckets.noResponse, fill: "#6b7280" },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Response Dashboard"
        description="Google Ads lead response time tracking"
      />

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <KpiCard title="Total Leads Tracked" value={data?.totalLeads || 0} icon={Users} />
        <KpiCard
          title="Avg Response Time"
          value={formatSeconds(data?.avgResponseSeconds)}
          icon={Clock}
        />
        <KpiCard
          title="Under 5 min"
          value={slaBuckets ? slaBuckets.under1 + slaBuckets.under5 : 0}
          icon={Zap}
        />
        <KpiCard
          title="No Response"
          value={slaBuckets?.noResponse || 0}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {slaChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={slaChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {slaChartData.map((entry, i) => (
                      <rect key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {isLoading ? "Loading..." : "No data yet"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performance by Rep</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.byUser?.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rep</TableHead>
                    <TableHead className="text-center">Leads</TableHead>
                    <TableHead className="text-center">Responded</TableHead>
                    <TableHead className="text-right">Avg Response</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byUser.map(
                    (u: {
                      userId: string;
                      userName: string;
                      totalLeads: number;
                      responded: number;
                      avgResponseSeconds: number | null;
                    }) => (
                      <TableRow key={u.userId}>
                        <TableCell className="font-medium text-sm">{u.userName}</TableCell>
                        <TableCell className="text-center">{u.totalLeads}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={u.responded === u.totalLeads ? "default" : "outline"}>
                            {u.responded}/{u.totalLeads}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {u.avgResponseSeconds ? (
                            <span
                              className={
                                u.avgResponseSeconds <= 300
                                  ? "text-green-600 font-medium"
                                  : u.avgResponseSeconds <= 600
                                    ? "text-amber-600"
                                    : "text-red-600 font-medium"
                              }
                            >
                              {formatSeconds(u.avgResponseSeconds)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {isLoading ? "Loading..." : "No data yet"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent Lead Responses</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.metrics?.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Email Received</TableHead>
                    <TableHead>SMS Sent</TableHead>
                    <TableHead>First Open</TableHead>
                    <TableHead>Acknowledged</TableHead>
                    <TableHead>First Contact</TableHead>
                    <TableHead className="text-right">Response Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.metrics.map(
                    (m: {
                      id: string;
                      leadId: string;
                      emailReceivedAt: string | null;
                      smsSentAt: string | null;
                      firstOpenAt: string | null;
                      acknowledgedAt: string | null;
                      firstContactedAt: string | null;
                      responseTimeSeconds: number | null;
                    }) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs font-mono">{m.leadId.slice(-8)}</TableCell>
                        <TableCell className="text-xs">
                          {m.emailReceivedAt ? format(new Date(m.emailReceivedAt), "MMM d, h:mm a") : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.smsSentAt ? format(new Date(m.smsSentAt), "h:mm:ss a") : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.firstOpenAt ? format(new Date(m.firstOpenAt), "h:mm:ss a") : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.acknowledgedAt ? format(new Date(m.acknowledgedAt), "h:mm:ss a") : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.firstContactedAt ? format(new Date(m.firstContactedAt), "h:mm:ss a") : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {m.responseTimeSeconds ? (
                            <span className={m.responseTimeSeconds <= 300 ? "text-green-600" : "text-red-600"}>
                              {formatSeconds(m.responseTimeSeconds)}
                            </span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {isLoading ? "Loading..." : "No response data yet. Leads from Google Ads emails will appear here."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
