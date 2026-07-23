"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth/session-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  Download,
  TriangleAlert,
  Undo2,
} from "lucide-react";

type JobSplit = {
  jobId: string;
  jobNumber: string;
  title: string;
  hours: number;
  amount: number;
};

type PayrollRow = {
  personnelId: string;
  name: string;
  entity: string | null;
  employmentType: string;
  regularHours: number;
  otHours: number;
  totalHours: number;
  gross: number;
  zeroRate: boolean;
  unapprovedDates: string[];
  byJob: JobSplit[];
  payment: {
    id: string;
    paidAt: string;
    grossAmount: number;
    method: string | null;
    reference: string | null;
    paidBy: string;
  } | null;
};

type PayrollWeek = { weekStart: string; weekEnd: string; rows: PayrollRow[] };

const METHODS = ["CHECK", "ACH", "CASH", "CARD", "WIRE", "OTHER"] as const;

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PayrollPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  // Default to the most recent completed week (bookkeeper pays last week).
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return shiftDays(today, -7);
  });
  const [payFor, setPayFor] = useState<PayrollRow | null>(null);
  const [method, setMethod] = useState<string>("CHECK");
  const [reference, setReference] = useState("");

  const { data, isLoading, error } = useQuery<PayrollWeek>({
    queryKey: ["payroll-week", anchor],
    queryFn: async () => {
      const res = await fetch(`/api/reports/field-labor/payroll?weekStart=${anchor}`);
      if (res.status === 403) throw new Error("Ask an admin for the payroll permission.");
      if (!res.ok) throw new Error("Failed to load payroll");
      return res.json();
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["payroll-week"] });

  const pay = useMutation({
    mutationFn: async (row: PayrollRow) => {
      const res = await fetch("/api/reports/field-labor/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: data!.weekStart,
          personnelId: row.personnelId,
          method,
          reference: reference.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to mark paid");
      return body as { gross: number; jobs: JobSplit[] };
    },
    onSuccess: (d, row) => {
      setPayFor(null);
      setReference("");
      refresh();
      toast.success(
        `${row.name} marked paid — ${money(d.gross)} posted to ${d.jobs.length} job${d.jobs.length === 1 ? "" : "s"}`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unpay = useMutation({
    mutationFn: async (row: PayrollRow) => {
      const res = await fetch("/api/reports/field-labor/payroll", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: data!.weekStart, personnelId: row.personnelId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to undo");
    },
    onSuccess: (_d, row) => {
      refresh();
      toast.success(`Payment undone for ${row.name} — job expenses removed`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = data?.rows ?? [];
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const paidCount = rows.filter((r) => r.payment).length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/reports/labor">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> Labor Reports
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Weekly Payroll</h1>
        <div className="flex-1" />
        {data && (
          <a href={`/api/reports/field-labor/payroll-export?weekStart=${data.weekStart}`} download>
            <Button variant="outline" size="sm">
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          </a>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <Button variant="outline" size="sm" onClick={() => setAnchor(shiftDays(anchor, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="sm" onClick={() => setAnchor(shiftDays(anchor, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {data && (
            <span className="font-medium">
              Week of {format(new Date(`${data.weekStart}T12:00:00`), "MMM d")} –{" "}
              {format(new Date(`${data.weekEnd}T12:00:00`), "MMM d, yyyy")}
            </span>
          )}
          <div className="flex-1" />
          {rows.length > 0 && (
            <span className="text-muted-foreground text-sm">
              {rows.length} worker{rows.length === 1 ? "" : "s"} · {money(totalGross)} gross ·{" "}
              {paidCount}/{rows.length} paid
            </span>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-muted-foreground py-12 text-center">{(error as Error).message}</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground rounded-md border py-12 text-center">
          No hours logged in this week.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead className="text-right">Reg</TableHead>
                <TableHead className="text-right">OT</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead>Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.personnelId}>
                  <TableCell className="font-medium">
                    {row.name}
                    {row.zeroRate && (
                      <span title="Has days with a $0 rate">
                        <TriangleAlert className="ml-1 inline h-4 w-4 text-amber-600" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.entity ?? "—"}</TableCell>
                  <TableCell className="text-right">{row.regularHours}</TableCell>
                  <TableCell className="text-right">{row.otHours > 0 ? row.otHours : "—"}</TableCell>
                  <TableCell className="text-right font-medium">{money(row.gross)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.byJob.map((j) => (
                      <div key={j.jobId}>
                        {j.jobNumber} · {money(j.amount)}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    {row.payment ? (
                      <div className="flex items-center gap-2">
                        <Badge className="bg-green-100 text-green-800">
                          Paid {format(new Date(row.payment.paidAt), "MMM d")}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {row.payment.method ?? ""}
                          {row.payment.reference ? ` #${row.payment.reference}` : ""} by{" "}
                          {row.payment.paidBy}
                        </span>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Undo payment (removes the posted job expenses)"
                            disabled={unpay.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `Undo the ${money(row.payment!.grossAmount)} payment for ${row.name}? The posted job expenses will be removed.`,
                                )
                              ) {
                                unpay.mutate(row);
                              }
                            }}
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : row.unapprovedDates.length > 0 ? (
                      <span className="flex items-center gap-1 text-sm text-amber-700">
                        <TriangleAlert className="h-4 w-4" />
                        Approve {row.unapprovedDates.length} day
                        {row.unapprovedDates.length === 1 ? "" : "s"} first
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setPayFor(row);
                          setReference("");
                        }}
                      >
                        <BadgeDollarSign className="mr-1 h-4 w-4" /> Mark paid
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Marking a week paid posts a LABOR expense on every job the worker
        touched that week (split by the hours worked there) and locks those
        hours. Payment requires every day of the week to be approved.
      </p>

      <Dialog open={payFor !== null} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark paid — {payFor?.name}</DialogTitle>
          </DialogHeader>
          {payFor && (
            <div className="space-y-4">
              <div className="rounded-md bg-gray-50 p-3 text-sm">
                <div className="flex justify-between font-medium">
                  <span>
                    {payFor.totalHours}h ({payFor.regularHours} reg
                    {payFor.otHours > 0 ? ` + ${payFor.otHours} OT` : ""})
                  </span>
                  <span>{money(payFor.gross)}</span>
                </div>
                <div className="text-muted-foreground mt-2 space-y-0.5">
                  {payFor.byJob.map((j) => (
                    <div key={j.jobId} className="flex justify-between">
                      <span>
                        {j.jobNumber} — {j.title}
                      </span>
                      <span>{money(j.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Method</Label>
                  <select
                    className="border-input h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Reference (check # etc.)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                Posts {money(payFor.gross)} as labor expenses across{" "}
                {payFor.byJob.length} job{payFor.byJob.length === 1 ? "" : "s"} and locks the
                week&apos;s hours.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayFor(null)}>
                  Cancel
                </Button>
                <Button disabled={pay.isPending} onClick={() => pay.mutate(payFor)}>
                  {pay.isPending ? "Saving…" : `Mark ${money(payFor.gross)} paid`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
