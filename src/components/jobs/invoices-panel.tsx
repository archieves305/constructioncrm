"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { computeApplication, type ComputedApplication } from "@/lib/billing/g702";

type InvoicePayment = {
  id: string;
  amount: string;
  receivedDate: string | null;
  method: string | null;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  amount: string;
  status: "DRAFT" | "SENT" | "PAID" | "VOID";
  paidAt: string | null;
  applicationNumber: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  payments: InvoicePayment[];
  changeOrder: { number: number } | null;
};

type SovLine = {
  id: string;
  itemNo: number;
  description: string;
  scheduledValue: number;
  sortOrder: number;
};

type ApplicationSummary = {
  id: string;
  applicationNumber: number;
  status: Invoice["status"];
  computed: ComputedApplication;
};

type BillingSummary = {
  billingMethod: "LUMP_SUM" | "PROGRESS";
  retainagePercent: number;
  contractSum: number;
  sovLines: SovLine[];
  sovTotal: number;
  sovMatchesContract: boolean;
  applications: ApplicationSummary[];
  totals: {
    completedToDate: number;
    retainageHeld: number;
    billedToDate: number;
    collected: number;
    openReceivable: number;
    balanceToFinish: number;
  };
  hasDraft: boolean;
  nextApplicationNumber: number;
  nextPeriodFrom: string | null;
};

const STATUSES = ["DRAFT", "SENT", "PAID", "VOID"] as const;
const BILLING_ROLES = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

const money = (n: number | string) =>
  `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number | string) => `$${Number(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const endOfMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
};

export function InvoicesPanel({
  jobId,
  billingMethod,
  retainagePercent,
}: {
  jobId: string;
  billingMethod: "LUMP_SUM" | "PROGRESS";
  retainagePercent: number;
}) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canManage = BILLING_ROLES.includes(session?.user?.role ?? "");
  const isProgress = billingMethod === "PROGRESS";

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", jobId],
    queryFn: () => fetchJson(`/api/jobs/${jobId}/invoices`),
  });

  const { data: billing } = useQuery<BillingSummary>({
    queryKey: ["billing", jobId],
    queryFn: () => fetchJson(`/api/jobs/${jobId}/billing`),
    enabled: isProgress,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["invoices", jobId] });
    qc.invalidateQueries({ queryKey: ["billing", jobId] });
    qc.invalidateQueries({ queryKey: ["job", jobId] });
  };

  // ── Billing settings ──────────────────────────────────────────────────────
  const [retainageDraft, setRetainageDraft] = useState<string | null>(null);
  const saveSettings = useMutation({
    mutationFn: (data: { billingMethod?: string; retainagePercent?: number }) =>
      fetchJson(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      refresh();
      setRetainageDraft(null);
      toast.success("Billing settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Lump-sum invoice ──────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: () =>
      fetchJson(`/api/jobs/${jobId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      refresh();
      toast.success("Invoice created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetchJson(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  function paidTotal(inv: Invoice) {
    return inv.payments.reduce((s, p) => s + Number(p.amount), 0);
  }

  function changeStatus(inv: Invoice, status: string) {
    // Payments drive status — warn if marking PAID without covering payments.
    if (status === "PAID" && paidTotal(inv) < Number(inv.amount)) {
      const ok = confirm(
        "No payment covers this invoice yet. Marking it Paid here won't record money received or reduce the balance. Record a payment on the Payments tab instead?\n\nClick OK to mark Paid anyway, Cancel to stop.",
      );
      if (!ok) return;
    }
    updateStatus.mutate({ id: inv.id, status });
  }

  // ── Schedule of values ────────────────────────────────────────────────────
  const [newLineDesc, setNewLineDesc] = useState("");
  const [newLineValue, setNewLineValue] = useState("");
  const [editingLine, setEditingLine] = useState<SovLine | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editValue, setEditValue] = useState("");

  const addLine = useMutation({
    mutationFn: () =>
      fetchJson(`/api/jobs/${jobId}/sov`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newLineDesc, scheduledValue: Number(newLineValue) }),
      }),
    onSuccess: () => {
      refresh();
      setNewLineDesc("");
      setNewLineValue("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveLine = useMutation({
    mutationFn: (line: SovLine) =>
      fetchJson(`/api/sov/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editDesc, scheduledValue: Number(editValue) }),
      }),
    onSuccess: () => {
      refresh();
      setEditingLine(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeLine = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/sov/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  // ── New / edit application dialog ─────────────────────────────────────────
  const [appOpen, setAppOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Invoice | null>(null);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [work, setWork] = useState<Record<string, string>>({});
  const [appNotes, setAppNotes] = useState("");
  const [sendNow, setSendNow] = useState(false);

  function openNewApp() {
    if (!billing) return;
    const from = billing.nextPeriodFrom ?? new Date().toISOString().slice(0, 10);
    setEditingApp(null);
    setPeriodFrom(from);
    setPeriodTo(endOfMonth(from));
    setWork({});
    setAppNotes("");
    setSendNow(false);
    setAppOpen(true);
  }

  function openEditApp(inv: Invoice) {
    if (!billing) return;
    const app = billing.applications.find((a) => a.id === inv.id);
    setEditingApp(inv);
    setPeriodFrom(inv.periodFrom ?? "");
    setPeriodTo(inv.periodTo ?? "");
    const w: Record<string, string> = {};
    for (const l of app?.computed.lines ?? []) if (l.thisPeriod > 0) w[l.sovLineId] = String(l.thisPeriod);
    setWork(w);
    setAppNotes("");
    setSendNow(false);
    setAppOpen(true);
  }

  // Live G702 preview from the issued applications plus what's being typed.
  const preview = useMemo(() => {
    if (!billing) return null;
    const previousByLine: Record<string, number> = {};
    for (const a of billing.applications) {
      if (a.status === "VOID" || a.status === "DRAFT") continue;
      for (const l of a.computed.lines)
        previousByLine[l.sovLineId] = (previousByLine[l.sovLineId] ?? 0) + l.thisPeriod;
    }
    return computeApplication({
      contractSum: billing.contractSum,
      retainagePercent: billing.retainagePercent,
      sovLines: billing.sovLines,
      previousByLine,
      previousCertificates: billing.totals.billedToDate,
      thisPeriod: billing.sovLines.map((s) => ({
        sovLineId: s.id,
        workCompleted: Number(work[s.id] || 0) || 0,
      })),
    });
  }, [billing, work]);

  const saveApp = useMutation({
    mutationFn: () => {
      const lines = Object.entries(work)
        .map(([sovLineId, v]) => ({ sovLineId, workCompleted: Number(v) || 0 }))
        .filter((l) => l.workCompleted > 0);
      if (editingApp) {
        return fetchJson(`/api/invoices/${editingApp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            periodFrom: periodFrom || null,
            periodTo,
            lines,
            ...(sendNow ? { status: "SENT" } : {}),
          }),
        });
      }
      return fetchJson(`/api/jobs/${jobId}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodFrom: periodFrom || null,
          periodTo,
          lines,
          notes: appNotes || null,
          status: sendNow ? "SENT" : "DRAFT",
        }),
      });
    },
    onSuccess: () => {
      refresh();
      setAppOpen(false);
      toast.success(editingApp ? "Application updated" : "Application created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overBilled = preview?.lines.some((l) => l.toDate > l.scheduledValue + 0.005) ?? false;
  const nothingBilled = (preview?.completedThisPeriod ?? 0) <= 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Settings + primary action */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Billing method</Label>
            {canManage ? (
              <Select
                value={billingMethod}
                onValueChange={(v: string | null) => {
                  if (!v || v === billingMethod) return;
                  if (
                    v === "LUMP_SUM" &&
                    (billing?.applications.length ?? 0) > 0 &&
                    !confirm(
                      "This job already has payment applications. Switching to lump-sum keeps them but stops new ones. Continue?",
                    )
                  )
                    return;
                  saveSettings.mutate({ billingMethod: v });
                }}
              >
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue>
                    {(v: string) =>
                      (v || billingMethod) === "PROGRESS" ? "Progress (applications)" : "Lump sum"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LUMP_SUM">Lump sum</SelectItem>
                  <SelectItem value="PROGRESS">Progress (applications)</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm">{isProgress ? "Progress (applications)" : "Lump sum"}</div>
            )}
          </div>
          {isProgress && (
            <div>
              <Label className="text-xs">Retainage %</Label>
              {canManage ? (
                <div className="flex items-center gap-1">
                  <Input
                    inputMode="decimal"
                    className="h-8 w-20 text-xs"
                    value={retainageDraft ?? String(retainagePercent)}
                    onChange={(e) => setRetainageDraft(e.target.value)}
                  />
                  {retainageDraft !== null && retainageDraft !== String(retainagePercent) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={saveSettings.isPending}
                      onClick={() => saveSettings.mutate({ retainagePercent: Number(retainageDraft) })}
                    >
                      Save
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm">{retainagePercent}%</div>
              )}
            </div>
          )}
        </div>
        {isProgress ? (
          canManage && (
            <Button
              size="sm"
              disabled={!billing || billing.hasDraft || billing.sovLines.length === 0}
              title={billing?.hasDraft ? "Finish or void the draft application first" : undefined}
              onClick={openNewApp}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Application{billing ? ` #${billing.nextApplicationNumber}` : ""}
            </Button>
          )
        ) : (
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
            <Plus className="mr-2 h-4 w-4" />
            {create.isPending ? "Creating…" : "New Invoice (balance due)"}
          </Button>
        )}
      </div>

      {/* G702 totals */}
      {isProgress && billing && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Contract sum" value={money0(billing.contractSum)} />
            <Stat
              label="Completed to date"
              value={money0(billing.totals.completedToDate)}
              sub={pct(billing.contractSum > 0 ? billing.totals.completedToDate / billing.contractSum : 0)}
            />
            <Stat label={`Retainage held (${billing.retainagePercent}%)`} value={money0(billing.totals.retainageHeld)} />
            <Stat label="Billed to date" value={money0(billing.totals.billedToDate)} sub="net of retainage" />
            <Stat
              label="Open receivable"
              value={money0(billing.totals.openReceivable)}
              sub={`${money0(billing.totals.collected)} collected`}
              tone={billing.totals.openReceivable > 0 ? "warn" : "ok"}
            />
            <Stat label="Balance to finish" value={money0(billing.totals.balanceToFinish)} sub="incl. retainage" />
          </CardContent>
        </Card>
      )}

      {/* Schedule of values */}
      {isProgress && billing && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">Schedule of values</div>
              {!billing.sovMatchesContract && (
                <div className="flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Lines total {money0(billing.sovTotal)} vs contract {money0(billing.contractSum)}
                </div>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Scheduled value</TableHead>
                  <TableHead className="text-right">Completed to date</TableHead>
                  <TableHead className="w-14 text-right">%</TableHead>
                  {canManage && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.sovLines.map((line) => {
                  const done = lineToDate(billing, line.id);
                  const editing = editingLine?.id === line.id;
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="text-muted-foreground">{line.itemNo}</TableCell>
                      <TableCell>
                        {editing ? (
                          <Input className="h-8" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                        ) : (
                          line.description
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editing ? (
                          <Input
                            className="h-8 text-right"
                            inputMode="decimal"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          />
                        ) : (
                          money(line.scheduledValue)
                        )}
                      </TableCell>
                      <TableCell className="text-right">{money(done)}</TableCell>
                      <TableCell className="text-right">
                        {pct(line.scheduledValue > 0 ? done / line.scheduledValue : 0)}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {editing ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingLine(null)}>
                                Cancel
                              </Button>
                              <Button size="sm" className="h-7 px-2" disabled={saveLine.isPending} onClick={() => saveLine.mutate(line)}>
                                Save
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                className="rounded p-1 hover:bg-gray-100"
                                title="Edit line"
                                onClick={() => {
                                  setEditingLine(line);
                                  setEditDesc(line.description);
                                  setEditValue(String(line.scheduledValue));
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {done === 0 && (
                                <button
                                  type="button"
                                  className="rounded p-1 text-red-600 hover:bg-red-50"
                                  title="Remove line"
                                  onClick={() => removeLine.mutate(line.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {canManage && (
                  <TableRow>
                    <TableCell className="text-muted-foreground">+</TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        placeholder="New line (e.g. CO#2 — added scope)"
                        value={newLineDesc}
                        onChange={(e) => setNewLineDesc(e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-right"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={newLineValue}
                        onChange={(e) => setNewLineValue(e.target.value)}
                      />
                    </TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={!newLineDesc.trim() || !newLineValue || addLine.isPending}
                        onClick={() => addLine.mutate()}
                      >
                        Add
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invoice / application list */}
      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {isProgress ? "No payment applications yet." : "No invoices yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const app = billing?.applications.find((a) => a.id === inv.id);
            return (
              <Card key={inv.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {inv.applicationNumber != null && (
                        <span className="text-sm font-semibold">App #{inv.applicationNumber}</span>
                      )}
                      <span className="font-mono text-sm font-medium">{inv.invoiceNumber}</span>
                      <span className="text-sm font-medium">{money0(inv.amount)}</span>
                      <Badge
                        variant={inv.status === "PAID" ? "default" : inv.status === "VOID" ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {inv.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {inv.periodTo && (
                        <>
                          Period {inv.periodFrom ? `${fmt(inv.periodFrom)} – ` : "to "}
                          {fmt(inv.periodTo)} ·{" "}
                        </>
                      )}
                      Issued {format(new Date(inv.issueDate), "MMM d, yyyy")}
                      {inv.dueDate && ` · Due ${format(new Date(inv.dueDate), "MMM d, yyyy")}`}
                      {inv.changeOrder && ` · from CO-${inv.changeOrder.number}`}
                    </div>
                    {app && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Work this period {money0(app.computed.completedThisPeriod)} · to date{" "}
                        {money0(app.computed.completedToDate)} ({pct(app.computed.contractSum > 0 ? app.computed.completedToDate / app.computed.contractSum : 0)})
                        {" · "}retainage {money0(app.computed.retainage)}
                      </div>
                    )}
                    {inv.payments.length > 0 && (
                      <div className="mt-1 text-xs text-green-700">
                        Paid {money0(paidTotal(inv))} of {money0(inv.amount)}
                        {" · "}
                        {inv.payments.length} payment{inv.payments.length > 1 ? "s" : ""}
                        {inv.paidAt && ` · settled ${format(new Date(inv.paidAt), "MMM d, yyyy")}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {app && inv.status === "DRAFT" && canManage && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEditApp(inv)}>
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                    )}
                    <Select
                      value={inv.status}
                      onValueChange={(v: string | null) => v && changeStatus(inv, v)}
                    >
                      <SelectTrigger className="h-7 w-[100px] text-xs">
                        <SelectValue>{(v: string) => v || inv.status}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <a
                      href={`/api/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      PDF
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New / edit application */}
      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingApp
                ? `Edit application #${editingApp.applicationNumber}`
                : `Payment application #${billing?.nextApplicationNumber ?? ""}`}
            </DialogTitle>
          </DialogHeader>
          {billing && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Period from</Label>
                  <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
                </div>
                <div>
                  <Label>Period to *</Label>
                  <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Scheduled</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                    <TableHead className="w-36 text-right">This period</TableHead>
                    <TableHead className="text-right">To date</TableHead>
                    <TableHead className="w-14 text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((l) => {
                    const over = l.toDate > l.scheduledValue + 0.005;
                    return (
                      <TableRow key={l.sovLineId}>
                        <TableCell className="text-muted-foreground">{l.itemNo}</TableCell>
                        <TableCell>{l.description}</TableCell>
                        <TableCell className="text-right">{money(l.scheduledValue)}</TableCell>
                        <TableCell className="text-right">{money(l.previous)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            className={`h-8 text-right ${over ? "border-red-500" : ""}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={work[l.sovLineId] ?? ""}
                            onChange={(e) => setWork((w) => ({ ...w, [l.sovLineId]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell className={`text-right ${over ? "text-red-600" : ""}`}>{money(l.toDate)}</TableCell>
                        <TableCell className={`text-right ${over ? "text-red-600" : ""}`}>{pct(l.percent)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="rounded border bg-gray-50 p-3 text-sm">
                <Row label="Total completed to date" value={money(preview.completedToDate)} />
                <Row label={`Less retainage (${preview.retainagePercent}%)`} value={`−${money(preview.retainage)}`} />
                <Row label="Total earned less retainage" value={money(preview.earnedLessRetainage)} />
                <Row label="Less previous certificates" value={`−${money(preview.previousCertificates)}`} />
                <Row label="Current payment due" value={money(preview.currentDue)} bold />
                <Row label="Balance to finish (incl. retainage)" value={money(preview.balanceToFinish)} muted />
              </div>

              {!editingApp && (
                <div>
                  <Label>Notes (printed on the application)</Label>
                  <Textarea rows={2} value={appNotes} onChange={(e) => setAppNotes(e.target.value)} />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
                Mark as sent (ages into A/R immediately)
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saveApp.isPending || !periodTo || overBilled || nothingBilled || (preview?.currentDue ?? 0) < 0}
              onClick={() => saveApp.mutate()}
            >
              {saveApp.isPending ? "Saving…" : editingApp ? "Save changes" : sendNow ? "Create & send" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmt(iso: string) {
  return format(new Date(`${iso.slice(0, 10)}T12:00:00`), "MMM d, yyyy");
}

/** Work billed to date on one SOV line, from the issued applications. */
function lineToDate(billing: BillingSummary, sovLineId: string): number {
  let total = 0;
  for (const a of billing.applications) {
    if (a.status === "VOID" || a.status === "DRAFT") continue;
    total += a.computed.lines.find((l) => l.sovLineId === sovLineId)?.thisPeriod ?? 0;
  }
  return Math.round(total * 100) / 100;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "ok";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === "warn" ? "text-red-600" : tone === "ok" ? "text-green-600" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
