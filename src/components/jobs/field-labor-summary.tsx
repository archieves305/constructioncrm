"use client";

import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, DollarSign, Flame, Users, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Bucket = {
  key: string;
  label: string;
  hours: number;
  regularHours: number;
  otHours: number;
  daysWorked: number;
  cost?: number;
};

type LaborSummary = {
  totals: Bucket;
  byWorker: Bucket[];
  byTrade: Bucket[];
  byCostCode: Bucket[];
  byWeek: Bucket[];
  budgetVsActual?: {
    budgetLineId: string;
    name: string;
    budget: number;
    fieldLaborActual: number;
    totalAllocated: number;
    remaining: number;
  }[];
  burn?: {
    avgDailyCost: number;
    avgDailyHours: number;
    lastWeekCost: number;
    laborBudget: number;
    projectedDaysRemaining: number | null;
  };
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Field-labor roll-up atop the Daily Logs tab. Cost tiles appear only when
// the API returned cost fields (server-shaped by role) — hours-only viewers
// get the hours variant, not blanked-out dollar tiles.
export function FieldLaborSummary({ jobId }: { jobId: string }) {
  const { data, isLoading } = useQuery<LaborSummary>({
    queryKey: ["labor-summary", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/labor-summary`).then((r) => r.json()),
  });

  if (isLoading || !data) return null;
  if (data.totals.hours === 0) return null;

  const withCost = data.totals.cost !== undefined;
  const chartData = data.byWeek.map((w) => ({
    week: w.key.slice(5), // MM-DD
    hours: w.hours,
    ...(withCost ? { cost: w.cost } : {}),
  }));

  return (
    <div className="mb-6 space-y-4">
      <div className={`grid gap-4 ${withCost ? "md:grid-cols-4" : "md:grid-cols-2"}`}>
        <KpiCard
          title="Field Labor Hours"
          value={data.totals.hours.toLocaleString()}
          description={`${data.totals.otHours} OT · ${data.totals.daysWorked} days worked`}
          icon={Clock}
        />
        <KpiCard
          title="Crew Size (avg)"
          value={
            data.totals.daysWorked > 0
              ? Math.round(
                  (data.byWorker.reduce((s, w) => s + w.daysWorked, 0) /
                    data.totals.daysWorked) *
                    10,
                ) / 10
              : 0
          }
          description={`${data.byWorker.length} workers total`}
          icon={Users}
        />
        {withCost && (
          <KpiCard
            title="Field Labor Cost"
            value={money(data.totals.cost!)}
            description={
              data.burn?.laborBudget
                ? `of ${money(data.burn.laborBudget)} budgeted`
                : "no labor budget lines linked"
            }
            icon={DollarSign}
          />
        )}
        {withCost && data.burn && (
          <KpiCard
            title="Burn Rate"
            value={`${money(data.burn.avgDailyCost)}/day`}
            description={
              data.burn.projectedDaysRemaining != null
                ? `~${data.burn.projectedDaysRemaining} work days of budget left`
                : `${money(data.burn.lastWeekCost)} last week`
            }
            icon={Flame}
          />
        )}
      </div>

      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Weekly {withCost ? "cost" : "hours"}</CardTitle>
          </CardHeader>
          <CardContent className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip
                  formatter={(v) =>
                    withCost ? money(Number(v ?? 0)) : `${Number(v ?? 0)}h`
                  }
                />
                <Bar
                  dataKey={withCost ? "cost" : "hours"}
                  fill="#0f766e"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {withCost && (data.budgetVsActual?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4" /> Labor budget vs actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Budget line</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Field labor</TableHead>
                  <TableHead className="text-right">All allocated</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.budgetVsActual!.map((line) => (
                  <TableRow key={line.budgetLineId}>
                    <TableCell className="font-medium">{line.name}</TableCell>
                    <TableCell className="text-right">{money(line.budget)}</TableCell>
                    <TableCell className="text-right">
                      {money(line.fieldLaborActual)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(line.totalAllocated)}
                    </TableCell>
                    <TableCell
                      className={`text-right ${line.remaining < 0 ? "font-semibold text-red-600" : ""}`}
                    >
                      {money(line.remaining)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.byTrade.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By trade</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trade</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">OT</TableHead>
                  {withCost && <TableHead className="text-right">Cost</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byTrade.map((t) => (
                  <TableRow key={t.key}>
                    <TableCell>{t.label}</TableCell>
                    <TableCell className="text-right">{t.hours}</TableCell>
                    <TableCell className="text-right">{t.otHours}</TableCell>
                    {withCost && (
                      <TableCell className="text-right">{money(t.cost!)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
