"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, DollarSign, Receipt, Download, CloudUpload, CheckCircle2, AlertCircle } from "lucide-react";
import { BuildiumSyncDialog } from "@/components/jobs/buildium-sync-dialog";

const TYPES = [
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "PERMIT_FEE",
  "SUBCONTRACTOR",
  "CHANGE_ORDER",
  "OTHER",
] as const;

const METHODS = [
  "CHECK",
  "CARD",
  "ACH",
  "CASH",
  "FINANCING",
  "WIRE",
  "OTHER",
] as const;

type BuildiumSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "SKIPPED";

type Expense = {
  id: string;
  type: (typeof TYPES)[number];
  vendor: string | null;
  description: string | null;
  amount: string;
  incurredDate: string;
  paidMethod: (typeof METHODS)[number] | null;
  paidFrom: string | null;
  billable: boolean;
  buildiumBillId: string | null;
  buildiumSyncStatus: BuildiumSyncStatus | null;
  buildiumSyncError: string | null;
  buildiumSyncedAt: string | null;
  createdBy: { firstName: string; lastName: string };
};

type Form = {
  type: (typeof TYPES)[number];
  vendor: string;
  description: string;
  amount: string;
  incurredDate: string;
  paidMethod: (typeof METHODS)[number] | "";
  paidFrom: string;
  billable: boolean;
};

const emptyForm: Form = {
  type: "MATERIAL",
  vendor: "",
  description: "",
  amount: "",
  incurredDate: new Date().toISOString().slice(0, 10),
  paidMethod: "",
  paidFrom: "",
  billable: false,
};

type PaymentSource = { id: string; name: string; isActive: boolean };

type CostPlusMeta = {
  laborCost: number;
  marginType: "PERCENT" | "FLAT" | null;
  marginValue: number;
};

export function ExpensesPanel({
  jobId,
  jobType,
  contractAmount,
  costPlus,
  rentalTurnover,
}: {
  jobId: string;
  jobType: "FIXED_PRICE" | "COST_PLUS";
  contractAmount: number;
  costPlus?: CostPlusMeta;
  rentalTurnover?: { linked: boolean };
}) {
  const isCostPlus = jobType === "COST_PLUS";
  const isRentalTurnover = Boolean(rentalTurnover);
  const buildiumLinked = Boolean(rentalTurnover?.linked);
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(emptyForm);

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ["expenses", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/expenses`).then((r) => r.json()),
  });

  const { data: sources = [] } = useQuery<PaymentSource[]>({
    queryKey: ["payment-sources"],
    queryFn: () =>
      fetch("/api/admin/payment-sources?activeOnly=true").then((r) => r.json()),
  });

  const addSource = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/admin/payment-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Add failed" }));
        throw new Error(err.error || "Add failed");
      }
      return res.json() as Promise<PaymentSource>;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["payment-sources"] });
      setForm((f) => ({ ...f, paidFrom: s.name }));
      toast.success(`Added "${s.name}"`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          vendor: form.vendor || null,
          description: form.description || null,
          amount: Number(form.amount),
          incurredDate: form.incurredDate,
          paidMethod: form.paidMethod || null,
          paidFrom: form.paidFrom || null,
          billable: form.billable,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      setForm({ ...emptyForm, type: form.type });
      toast.success("Expense added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBillable = useMutation({
    mutationFn: ({ id, billable }: { id: string; billable: boolean }) =>
      fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billable }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/expenses/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      toast.success("Expense deleted");
    },
  });

  const [syncExpense, setSyncExpense] = useState<Expense | null>(null);

  const { totalNonBillable, totalBillable, totalAll, totalSynced, totalUnsynced } = useMemo(() => {
    let totalNonBillable = 0;
    let totalBillable = 0;
    let totalAll = 0;
    let totalSynced = 0;
    let totalUnsynced = 0;
    for (const e of expenses) {
      const n = Number(e.amount);
      totalAll += n;
      if (e.billable) totalBillable += n;
      else totalNonBillable += n;
      if (e.buildiumBillId) totalSynced += n;
      else totalUnsynced += n;
    }
    return { totalNonBillable, totalBillable, totalAll, totalSynced, totalUnsynced };
  }, [expenses]);

  const estimatedProfit = contractAmount - totalNonBillable;

  const marginAmount = (() => {
    if (!isCostPlus || !costPlus) return 0;
    const base = costPlus.laborCost + totalAll;
    if (costPlus.marginType === "FLAT") return costPlus.marginValue;
    if (costPlus.marginType === "PERCENT") return base * (costPlus.marginValue / 100);
    return 0;
  })();

  const totalBillableCostPlus = isCostPlus && costPlus
    ? costPlus.laborCost + totalAll + marginAmount
    : 0;

  const canSave = form.amount && Number(form.amount) > 0;

  return (
    <div className="space-y-4">
      {/* Rental turnover summary */}
      {isRentalTurnover && (
        <div className="grid grid-cols-3 gap-3 rounded-md border border-blue-200 bg-blue-50/60 p-2">
          <div>
            <div className="text-[10px] uppercase text-blue-900">Turnover cost</div>
            <div className="text-lg font-semibold text-blue-900">
              ${totalAll.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-blue-900">Posted to Buildium</div>
            <div className="text-lg font-semibold text-emerald-700">
              ${totalSynced.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-blue-900">Not yet posted</div>
            <div className={`text-lg font-semibold ${totalUnsynced > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
              ${totalUnsynced.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Summary — differs by job type */}
      {isCostPlus ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Labor
              </div>
              <div className="text-lg font-semibold">
                ${(costPlus?.laborCost ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Expenses
              </div>
              <div className="text-lg font-semibold">
                ${totalAll.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Margin{" "}
                {costPlus?.marginType === "PERCENT"
                  ? `(${costPlus.marginValue}%)`
                  : ""}
              </div>
              <div className="text-lg font-semibold text-emerald-700">
                ${Math.round(marginAmount).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Total billable
              </div>
              <div className="text-lg font-semibold">
                ${Math.round(totalBillableCostPlus).toLocaleString()}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                Labor + Expenses + Margin
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Contract
              </div>
              <div className="text-lg font-semibold">
                ${contractAmount.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Billable add-ons
              </div>
              <div className="text-lg font-semibold text-blue-700">
                +${totalBillable.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Costs (non-billable)
              </div>
              <div className="text-lg font-semibold text-red-700">
                -${totalNonBillable.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">
                Est. profit
              </div>
              <div
                className={`text-lg font-semibold ${
                  estimatedProfit >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                ${estimatedProfit.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create form */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            <div>
              <Label className="text-xs">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v: string | null) =>
                  setForm({ ...form, type: (v as Form["type"]) || "OTHER" })
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string) => v?.replace(/_/g, " ") || "Type"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Vendor</Label>
              <Input
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="Home Depot"
              />
            </div>
            <div>
              <Label className="text-xs">Amount ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={form.incurredDate}
                onChange={(e) =>
                  setForm({ ...form, incurredDate: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col justify-end">
              {isCostPlus ? (
                <p className="mb-1 text-[11px] text-muted-foreground">
                  Cost-plus: all expenses roll into contract automatically.
                </p>
              ) : (
                <Label className="mb-1 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.billable}
                    onChange={(e) =>
                      setForm({ ...form, billable: e.target.checked })
                    }
                  />
                  Billable (adds to contract)
                </Label>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Paid method</Label>
              <Select
                value={form.paidMethod || "__none"}
                onValueChange={(v: string | null) =>
                  setForm({
                    ...form,
                    paidMethod:
                      v && v !== "__none" ? (v as Form["paidMethod"]) : "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="—">
                    {(v: string) =>
                      !v || v === "__none" ? "—" : v
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— not specified —</SelectItem>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Paid from (account / card)</Label>
              <div className="flex gap-2">
                <Select
                  value={form.paidFrom || "__none"}
                  onValueChange={(v: string | null) => {
                    if (!v || v === "__none") {
                      setForm({ ...form, paidFrom: "" });
                    } else if (v === "__add") {
                      const name = window.prompt("New payment source name")?.trim();
                      if (name) addSource.mutate(name);
                    } else {
                      setForm({ ...form, paidFrom: v });
                    }
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select account">
                      {(v: string) => (!v || v === "__none" ? "—" : v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— not specified —</SelectItem>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="__add">+ Add new source…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <Textarea
            placeholder="Notes / description (optional)"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!canSave || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" />
              {create.isPending ? "Saving…" : "Add Expense"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List + export */}
      {expenses.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {expenses.length} expense{expenses.length === 1 ? "" : "s"}
          </p>
          <a
            href={`/api/jobs/${jobId}/expenses/qbo-export`}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
          >
            <Download className="h-3 w-3" />
            Export to QuickBooks
          </a>
        </div>
      )}

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No expenses recorded yet.
        </p>
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline" className="text-[10px]">
                      {e.type.replace(/_/g, " ")}
                    </Badge>
                    {e.vendor && (
                      <span className="text-sm font-medium">{e.vendor}</span>
                    )}
                    <span className="text-sm font-semibold">
                      ${Number(e.amount).toLocaleString()}
                    </span>
                    {e.billable && (
                      <Badge variant="default" className="text-[10px]">
                        Billable
                      </Badge>
                    )}
                    {isRentalTurnover && (
                      <>
                        {e.buildiumBillId ? (
                          <Badge variant="outline" className="border-emerald-500 text-[10px] text-emerald-700">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />
                            Buildium #{e.buildiumBillId}
                          </Badge>
                        ) : e.buildiumSyncStatus === "FAILED" ? (
                          <Badge variant="outline" className="border-red-500 text-[10px] text-red-700" title={e.buildiumSyncError ?? undefined}>
                            <AlertCircle className="mr-1 inline h-3 w-3" />
                            Sync failed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-gray-300 text-[10px] text-gray-600">
                            Not posted
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                  {isRentalTurnover && e.buildiumSyncStatus === "FAILED" && e.buildiumSyncError && (
                    <div className="mt-1 text-[10px] text-red-700">
                      {e.buildiumSyncError}
                    </div>
                  )}
                  {(e.paidMethod || e.paidFrom) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      {e.paidMethod && (
                        <Badge variant="secondary" className="text-[10px]">
                          {e.paidMethod}
                        </Badge>
                      )}
                      {e.paidFrom && (
                        <span className="text-muted-foreground">
                          from {e.paidFrom}
                        </span>
                      )}
                    </div>
                  )}
                  {e.description && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {e.description}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {format(new Date(e.incurredDate), "MMM d, yyyy")} · added by{" "}
                    {e.createdBy.firstName} {e.createdBy.lastName}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isCostPlus && (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={e.billable}
                        onChange={(ev) =>
                          toggleBillable.mutate({
                            id: e.id,
                            billable: ev.target.checked,
                          })
                        }
                      />
                      <DollarSign className="h-3 w-3" />
                      Bill
                    </label>
                  )}
                  {isRentalTurnover && !e.buildiumBillId && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setSyncExpense(e)}
                      disabled={!buildiumLinked}
                      title={
                        !buildiumLinked
                          ? "Link a Buildium property first"
                          : e.buildiumSyncStatus === "FAILED"
                            ? "Retry post to Buildium"
                            : "Post this expense to Buildium"
                      }
                    >
                      <CloudUpload className="h-3 w-3" />
                      {e.buildiumSyncStatus === "FAILED" ? "Retry" : "Post"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                    onClick={() => {
                      if (confirm("Delete this expense?")) remove.mutate(e.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {syncExpense && (
        <BuildiumSyncDialog
          open={Boolean(syncExpense)}
          onOpenChange={(open) => {
            if (!open) setSyncExpense(null);
          }}
          expense={{
            id: syncExpense.id,
            jobId,
            vendor: syncExpense.vendor,
            amount: syncExpense.amount,
          }}
        />
      )}
    </div>
  );
}
