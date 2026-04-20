"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
} from "recharts";

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = new URLSearchParams();
  params.set("type", "conversions");
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const { data: conversions } = useQuery({
    queryKey: ["report-conversions", dateFrom, dateTo],
    queryFn: () =>
      fetch(`/api/reports?${params.toString()}`).then((r) => r.json()),
  });

  const dashParams = new URLSearchParams();
  dashParams.set("type", "dashboard");
  if (dateFrom) dashParams.set("dateFrom", dateFrom);
  if (dateTo) dashParams.set("dateTo", dateTo);

  const { data: dashboard } = useQuery({
    queryKey: ["report-dashboard", dateFrom, dateTo],
    queryFn: () =>
      fetch(`/api/reports?${dashParams.toString()}`).then((r) => r.json()),
  });

  const funnel = conversions?.funnelMetrics;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Sales performance and conversion analysis"
        actions={
          <Button
            variant="outline"
            disabled={!conversions && !dashboard}
            onClick={() => {
              const sections: { name: string; rows: Record<string, unknown>[] }[] = [];
              if (funnel) {
                sections.push({
                  name: "Funnel",
                  rows: [
                    { metric: "Lead to Contact", percent: funnel.leadToContact },
                    { metric: "Contact to Appointment", percent: funnel.contactToAppointment },
                    {
                      metric: "Appointment to Estimate",
                      percent: funnel.appointmentToEstimate,
                    },
                    { metric: "Estimate to Won", percent: funnel.estimateToWon },
                    { metric: "Lead to Won", percent: funnel.leadToWon },
                  ],
                });
              }
              if (conversions?.stageCounts) {
                sections.push({
                  name: "Stage Distribution",
                  rows: conversions.stageCounts,
                });
              }
              if (dashboard?.bySource) {
                sections.push({ name: "By Source", rows: dashboard.bySource });
              }
              if (dashboard?.byRep) {
                sections.push({ name: "By Rep", rows: dashboard.byRep });
              }

              const parts: string[] = [];
              for (const s of sections) {
                if (!s.rows?.length) continue;
                const cols = Object.keys(s.rows[0]).map((k) => ({ key: k, header: k }));
                parts.push(`# ${s.name}\r\n${toCsv(s.rows, cols)}`);
              }
              downloadCsv(
                `report-${new Date().toISOString().slice(0, 10)}.csv`,
                parts.join("\r\n"),
              );
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
      />

      <div className="mb-6 flex gap-4">
        <div>
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            {funnel ? (
              <div className="space-y-3">
                {[
                  { label: "Lead to Contact", value: funnel.leadToContact },
                  { label: "Contact to Appointment", value: funnel.contactToAppointment },
                  { label: "Appointment to Estimate", value: funnel.appointmentToEstimate },
                  { label: "Estimate to Won", value: funnel.estimateToWon },
                  { label: "Lead to Won", value: funnel.leadToWon },
                ].map((metric) => (
                  <div key={metric.label} className="flex items-center justify-between">
                    <span className="text-sm">{metric.label}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${Math.min(Number(metric.value), 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-12 text-right">
                        {metric.value}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {conversions?.stageCounts?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={conversions.stageCounts}>
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
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard?.bySource?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dashboard.bySource} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="sourceName" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rep Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard?.byRep?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dashboard.byRep} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="userName" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
