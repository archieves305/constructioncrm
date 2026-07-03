"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Clock, DollarSign, Download, HardHat, Zap } from "lucide-react";
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
  cost: number;
  daysWorked: number;
};

type Report = {
  totals: { hours: number; regularHours: number; otHours: number; cost: number };
  byWorker: Bucket[];
  byTrade: Bucket[];
  byJob: Bucket[];
  byWeek: Bucket[];
};

const GROUPS = [
  { key: "byJob", label: "By job" },
  { key: "byWorker", label: "By worker" },
  { key: "byTrade", label: "By trade" },
  { key: "byWeek", label: "By week" },
] as const;

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function BookkeeperSetting() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const { data: settings } = useQuery<{
    otWeeklyThreshold: number;
    otDailyThreshold: number | null;
    otMultiplier: number;
    weekStartsOn: number;
    bookkeeperEmail: string | null;
    payrollApprovedOnly: boolean;
  }>({
    queryKey: ["labor-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/labor-settings");
      if (!res.ok) throw new Error("forbidden");
      const d = await res.json();
      setEmail(d.bookkeeperEmail ?? "");
      return d;
    },
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (overrides?: { payrollApprovedOnly?: boolean }) => {
      const res = await fetch("/api/admin/labor-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otWeeklyThreshold: settings!.otWeeklyThreshold,
          otDailyThreshold: settings!.otDailyThreshold,
          otMultiplier: settings!.otMultiplier,
          weekStartsOn: settings!.weekStartsOn,
          bookkeeperEmail: email.trim() || null,
          payrollApprovedOnly:
            overrides?.payrollApprovedOnly ?? settings!.payrollApprovedOnly,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed (admin only)");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-settings"] });
      toast.success("Bookkeeper email saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!settings) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <span className="text-muted-foreground text-sm">Bookkeeper email:</span>
      <Input
        type="email"
        placeholder="bookkeeper@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-64"
      />
      <Button size="sm" variant="outline" onClick={() => save.mutate({})} disabled={save.isPending}>
        Save
      </Button>
      <p className="text-muted-foreground w-full text-xs">
        Field Mode&apos;s &quot;send weekly hours&quot; button and the Friday
        payroll email both go to this address. Automatic send: Fridays at 5pm.
      </p>
      <label className="flex w-full cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.payrollApprovedOnly}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ payrollApprovedOnly: e.target.checked })}
        />
        Only count hours on office-approved logs in payroll exports/emails
      </label>
    </div>
  );
}

export default function LaborReportsPage() {
  const [from, setFrom] = useState(localDate(-28));
  const [to, setTo] = useState(localDate());
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("byJob");
  const [payrollWeek, setPayrollWeek] = useState(localDate(-7));

  const { data, isLoading, error } = useQuery<Report>({
    queryKey: ["field-labor-report", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/reports/field-labor?from=${from}&to=${to}`);
      if (res.status === 403) throw new Error("forbidden");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    retry: false,
  });

  if (error?.message === "forbidden") {
    return (
      <div className="p-6">
        <PageHeader title="Labor Reports" description="Field labor across all jobs" />
        <div className="text-muted-foreground rounded-md border py-12 text-center">
          Labor reports are payroll-level data. Ask an admin for the payroll
          permission.
        </div>
      </div>
    );
  }

  const rows = data?.[group] ?? [];

  const exportCsv = () => {
    const records = rows.map((r) => ({
      label: r.label,
      hours: r.hours,
      regularHours: r.regularHours,
      otHours: r.otHours,
      cost: r.cost.toFixed(2),
      daysWorked: r.daysWorked,
    }));
    downloadCsv(
      `labor-${group}-${from}-to-${to}.csv`,
      toCsv(records, [
        { key: "label", header: GROUPS.find((g) => g.key === group)!.label.replace("By ", "") },
        { key: "hours", header: "Hours" },
        { key: "regularHours", header: "Regular" },
        { key: "otHours", header: "OT" },
        { key: "cost", header: "Cost" },
        { key: "daysWorked", header: "Days" },
      ]),
    );
  };

  const chartData = (data?.byWeek ?? []).map((w) => ({
    week: w.key.slice(5),
    cost: w.cost,
    hours: w.hours,
  }));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Labor Reports"
        description="Field labor hours and cost across all jobs"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-muted-foreground text-sm">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard
              title="Total Hours"
              value={data.totals.hours.toLocaleString()}
              description={`${data.totals.regularHours} regular`}
              icon={Clock}
            />
            <KpiCard
              title="Overtime Hours"
              value={data.totals.otHours.toLocaleString()}
              description="paid at the OT multiplier"
              icon={Zap}
            />
            <KpiCard
              title="Labor Cost"
              value={money(data.totals.cost)}
              description="field labor actuals in range"
              icon={DollarSign}
            />
          </div>

          {chartData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Weekly labor cost</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                    <Bar dataKey="cost" fill="#0f766e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {GROUPS.map((g) => (
                  <Button
                    key={g.key}
                    size="sm"
                    variant={group === g.key ? "default" : "outline"}
                    onClick={() => setGroup(g.key)}
                  >
                    {g.label}
                  </Button>
                ))}
              </div>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No field labor in this date range.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{GROUPS.find((g) => g.key === group)!.label.replace("By ", "")}</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Regular</TableHead>
                      <TableHead className="text-right">OT</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-right">{r.hours}</TableCell>
                        <TableCell className="text-right">{r.regularHours}</TableCell>
                        <TableCell className="text-right">{r.otHours}</TableCell>
                        <TableCell className="text-right">{money(r.cost)}</TableCell>
                        <TableCell className="text-right">{r.daysWorked}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <HardHat className="h-4 w-4" /> Payroll export
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground text-sm">
                Week containing
              </span>
              <Input
                type="date"
                value={payrollWeek}
                onChange={(e) => setPayrollWeek(e.target.value)}
                className="w-40"
              />
              <a
                href={`/api/reports/field-labor/payroll-export?weekStart=${payrollWeek}`}
                download
              >
                <Button size="sm">
                  <Download className="mr-1 h-4 w-4" /> Download payroll CSV
                </Button>
              </a>
              <p className="text-muted-foreground w-full text-xs">
                One row per worker per rate: Mon–Sun hours, regular/OT split,
                and gross from the rates snapshotted on each day. Exports are
                logged.
              </p>
              <BookkeeperSetting />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
