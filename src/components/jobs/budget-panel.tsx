"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { Trash2, Plus, Upload, Download, Pencil, HardHat, Receipt, X } from "lucide-react";

type Allocation = {
  id: string;
  amount: string;
  expenseId: string | null;
  laborContractId: string | null;
};
type BudgetLine = {
  id: string;
  category: string | null;
  name: string;
  amount: string;
  allocations: Allocation[];
};
type Expense = { id: string; vendor: string | null; type: string; amount: string };
type LaborContract = {
  id: string;
  label: string | null;
  contractAmount: string;
  crew: { name: string } | null;
  changeOrders: { amount: string }[];
};

const UNSET = "__unset";

const laborRevised = (c: {
  contractAmount: string;
  changeOrders: { amount: string }[];
}) =>
  Number(c.contractAmount) +
  c.changeOrders.reduce((s, co) => s + Number(co.amount), 0);

type EditTarget = { kind: "expense" | "labor"; id: string; name: string; amount: number };
type Row = { budgetLineId: string; amount: string };

export function BudgetPanel({
  jobId,
  totalJobCost,
}: {
  jobId: string;
  totalJobCost: number;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: lines = [], isLoading } = useQuery<BudgetLine[]>({
    queryKey: ["budget", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/budget`).then((r) => r.json()),
  });
  const { data: expenses = [] } = useQuery<Expense[]>({
    queryKey: ["expenses", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/expenses`).then((r) => r.json()),
  });
  const { data: laborContracts = [] } = useQuery<LaborContract[]>({
    queryKey: ["labor-contracts", jobId],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/labor-contracts`).then((r) => r.json()),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["budget", jobId] });
    qc.invalidateQueries({ queryKey: ["expenses", jobId] });
    qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
    qc.invalidateQueries({ queryKey: ["job", jobId] });
  };

  const lineName = (l: BudgetLine | undefined) =>
    l ? (l.category ? `${l.category} · ${l.name}` : l.name) : "—";

  // ── Derived maps ─────────────────────────────────────────────────────────
  const allAllocations = useMemo(
    () => lines.flatMap((l) => l.allocations.map((a) => ({ ...a, budgetLineId: l.id }))),
    [lines],
  );
  const lineById = useMemo(() => {
    const m = new Map<string, BudgetLine>();
    lines.forEach((l) => m.set(l.id, l));
    return m;
  }, [lines]);
  const sourceName = (a: { expenseId: string | null; laborContractId: string | null }) => {
    if (a.expenseId) {
      const e = expenses.find((x) => x.id === a.expenseId);
      return e ? e.vendor || e.type.replace(/_/g, " ") : "Expense";
    }
    const c = laborContracts.find((x) => x.id === a.laborContractId);
    return c ? c.crew?.name ?? c.label ?? "Labor" : "Labor";
  };
  const allocFor = (kind: "expense" | "labor", id: string) =>
    allAllocations.filter((a) =>
      kind === "expense" ? a.expenseId === id : a.laborContractId === id,
    );

  const actualForLine = (l: BudgetLine) =>
    l.allocations.reduce((s, a) => s + Number(a.amount), 0);

  const { totalBudget, linkedSpend } = useMemo(() => {
    let totalBudget = 0;
    let linkedSpend = 0;
    for (const l of lines) {
      totalBudget += Number(l.amount);
      linkedSpend += actualForLine(l);
    }
    return { totalBudget, linkedSpend };
  }, [lines]);

  const variance = totalBudget - totalJobCost;
  const unbudgeted = totalJobCost - linkedSpend;

  // ── Upload ───────────────────────────────────────────────────────────────
  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/jobs/${jobId}/budget/import`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(err.error || "Import failed");
      }
      return res.json() as Promise<{ count: number }>;
    },
    onSuccess: (r) => {
      invalidateAll();
      toast.success(`Imported ${r.count} budget line${r.count === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    if (
      lines.length > 0 &&
      !confirm(
        "Uploading replaces the current budget and clears its allocations. Continue?",
      )
    ) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    importFile.mutate(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Line CRUD ──────────────────────────────────────────────────────────────
  const [newCategory, setNewCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const addLine = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/budget/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          category: newCategory || null,
          amount: Number(newAmount),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget", jobId] });
      setNewCategory("");
      setNewName("");
      setNewAmount("");
      toast.success("Budget line added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const startEdit = (l: BudgetLine) => {
    setEditName(l.name);
    setEditCategory(l.category ?? "");
    setEditAmount(String(Number(l.amount)));
    setEditing(l);
  };
  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const res = await fetch(`/api/budget-lines/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          category: editCategory || null,
          amount: Number(editAmount),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget", jobId] });
      setEditing(null);
      toast.success("Budget line updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteLine = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/budget-lines/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      invalidateAll();
      toast.success("Budget line removed");
    },
  });

  // ── Allocation editor ──────────────────────────────────────────────────────
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const openAllocator = (t: EditTarget) => {
    const existing = allocFor(t.kind, t.id);
    if (existing.length > 0) {
      setRows(existing.map((a) => ({ budgetLineId: a.budgetLineId, amount: String(Number(a.amount)) })));
    } else {
      // Default a single row with the full amount for the common case.
      setRows([{ budgetLineId: "", amount: String(t.amount) }]);
    }
    setTarget(t);
  };
  const rowsTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const rowsRemainder = (target?.amount ?? 0) - rowsTotal;
  const rowsValid =
    target !== null &&
    rowsTotal <= target.amount + 0.005 &&
    rows.every((r) => r.budgetLineId && Number(r.amount) > 0);

  const saveAllocations = useMutation({
    mutationFn: async () => {
      if (!target) return;
      const url =
        target.kind === "expense"
          ? `/api/expenses/${target.id}/budget-allocations`
          : `/api/labor-contracts/${target.id}/budget-allocations`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: rows
            .filter((r) => r.budgetLineId && Number(r.amount) > 0)
            .map((r) => ({ budgetLineId: r.budgetLineId, amount: Number(r.amount) })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget", jobId] });
      setTarget(null);
      toast.success("Allocations saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canAddLine = newName.trim() && newAmount && Number(newAmount) >= 0;

  // Unified spend items for the assignment section.
  const spendItems: EditTarget[] = [
    ...laborContracts.map((c) => ({
      kind: "labor" as const,
      id: c.id,
      name: c.crew?.name ?? c.label ?? "Labor",
      amount: laborRevised(c),
    })),
    ...expenses.map((e) => ({
      kind: "expense" as const,
      id: e.id,
      name: e.vendor || e.type.replace(/_/g, " "),
      amount: Number(e.amount),
    })),
  ];

  if (isLoading)
    return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;

  // ── Empty state ────────────────────────────────────────────────────────────
  if (lines.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">No budget yet</p>
              <p className="text-xs text-muted-foreground">
                Upload a budget spreadsheet (.xlsx or .csv) with columns:
                Category, Line item, Budget.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
              <Button
                size="sm"
                disabled={importFile.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1 h-4 w-4" />
                {importFile.isPending ? "Importing…" : "Upload spreadsheet"}
              </Button>
              <a
                href={`/api/jobs/${jobId}/budget/template`}
                className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                <Download className="h-3 w-3" />
                Download template
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-xs text-muted-foreground">Or add lines manually:</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <Input placeholder="Category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
              <Input placeholder="Line item" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input type="number" min={0} step="0.01" placeholder="Budget $" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
              <Button size="sm" disabled={!canAddLine || addLine.isPending} onClick={() => addLine.mutate()}>
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Loaded state ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Total budget</div>
          <div className="text-lg font-semibold">${totalBudget.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Spent (job cost)</div>
          <div className="text-lg font-semibold">${totalJobCost.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">{variance >= 0 ? "Under budget" : "Over budget"}</div>
          <div className={`text-lg font-semibold ${variance >= 0 ? "text-emerald-700" : "text-red-700"}`}>${Math.abs(variance).toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Unbudgeted spend</div>
          <div className={`text-lg font-semibold ${unbudgeted > 0.005 ? "text-amber-700" : "text-muted-foreground"}`}>${unbudgeted.toLocaleString()}</div>
        </CardContent></Card>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
        <Button size="sm" variant="outline" disabled={importFile.isPending} onClick={() => fileRef.current?.click()}>
          <Upload className="mr-1 h-4 w-4" />
          {importFile.isPending ? "Importing…" : "Re-upload (replace)"}
        </Button>
        <a href={`/api/jobs/${jobId}/budget/template`} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-gray-50">
          <Download className="h-3 w-3" /> Template
        </a>
      </div>

      {/* Budget lines */}
      <div className="space-y-2">
        {lines.map((l) => {
          const budget = Number(l.amount);
          const actual = actualForLine(l);
          const v = budget - actual;
          return (
            <Card key={l.id}>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {l.category && <Badge variant="outline" className="text-[10px]">{l.category}</Badge>}
                    <span className="text-sm font-medium">{l.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="rounded p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-foreground" title="Edit line" onClick={() => startEdit(l)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive" title="Remove line" onClick={() => { if (confirm("Remove this budget line?")) deleteLine.mutate(l.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Budget</div>
                    <div className="font-semibold">${budget.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Actual</div>
                    <div className="font-semibold">${actual.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">{v >= 0 ? "Under" : "Over"}</div>
                    <div className={`font-semibold ${v >= 0 ? "text-emerald-700" : "text-red-700"}`}>${Math.abs(v).toLocaleString()}</div>
                  </div>
                </div>
                {l.allocations.length > 0 && (
                  <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                    {l.allocations.map((a) => (
                      <div key={a.id} className="flex items-center gap-2">
                        {a.laborContractId ? <HardHat className="h-3 w-3" /> : <Receipt className="h-3 w-3" />}
                        {sourceName(a)} — ${Number(a.amount).toLocaleString()}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add line */}
      <Card>
        <CardContent className="space-y-2 pt-4">
          <p className="text-xs text-muted-foreground">Add a budget line</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Input placeholder="Category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
            <Input placeholder="Line item" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input type="number" min={0} step="0.01" placeholder="Budget $" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
            <Button size="sm" disabled={!canAddLine || addLine.isPending} onClick={() => addLine.mutate()}>
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Assignment: allocate spend to budget lines (splittable) */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-medium">Allocate spend to budget lines</p>
          {spendItems.length === 0 && (
            <p className="text-xs text-muted-foreground">No expenses or labor contracts to allocate yet.</p>
          )}
          {spendItems.map((item) => {
            const itemAllocs = allocFor(item.kind, item.id);
            const allocated = itemAllocs.reduce((s, a) => s + Number(a.amount), 0);
            const remainder = item.amount - allocated;
            return (
              <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {item.kind === "labor" ? <HardHat className="h-4 w-4 text-muted-foreground" /> : <Receipt className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground">${item.amount.toLocaleString()}</span>
                  </div>
                  {itemAllocs.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {itemAllocs.map((a) => (
                        <Badge key={a.id} variant="secondary" className="text-[10px]">
                          {lineName(lineById.get(a.budgetLineId))}: ${Number(a.amount).toLocaleString()}
                        </Badge>
                      ))}
                      {remainder > 0.005 && (
                        <Badge variant="outline" className="text-[10px] text-amber-700">
                          unallocated ${remainder.toLocaleString()}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-muted-foreground">Unallocated</div>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => openAllocator(item)}>
                  {itemAllocs.length > 0 ? "Edit split" : "Allocate"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Edit line dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={(o: boolean) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit budget line</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input placeholder="Category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
            <Input placeholder="Line item" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <Input type="number" min={0} step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" disabled={!editName.trim() || saveEdit.isPending} onClick={() => saveEdit.mutate()}>
              {saveEdit.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Allocation editor dialog */}
      <Dialog open={Boolean(target)} onOpenChange={(o: boolean) => !o && setTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Allocate {target?.name}
              {target ? ` — $${target.amount.toLocaleString()}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={r.budgetLineId || UNSET}
                  onValueChange={(v: string | null) =>
                    setRows((rs) => rs.map((row, j) => (j === i ? { ...row, budgetLineId: !v || v === UNSET ? "" : v } : row)))
                  }
                >
                  <SelectTrigger className="h-9 flex-1 text-xs">
                    <SelectValue>
                      {(v: string) => (!v || v === UNSET ? "Select line" : lineName(lineById.get(v)))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {lines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{lineName(l)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-28"
                  value={r.amount}
                  onChange={(e) => setRows((rs) => rs.map((row, j) => (j === i ? { ...row, amount: e.target.value } : row)))}
                />
                <button type="button" className="rounded p-1.5 text-muted-foreground hover:text-destructive" title="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows((rs) => [...rs, { budgetLineId: "", amount: String(Math.max(0, rowsRemainder)) }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add split
            </Button>
            <div className={`text-xs ${rowsRemainder < -0.005 ? "text-red-700" : "text-muted-foreground"}`}>
              Allocated ${rowsTotal.toLocaleString()} of ${(target?.amount ?? 0).toLocaleString()} ·{" "}
              {rowsRemainder < -0.005
                ? `over by $${Math.abs(rowsRemainder).toLocaleString()}`
                : `${rowsRemainder.toLocaleString()} unallocated`}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTarget(null)}>Cancel</Button>
            <Button size="sm" disabled={!rowsValid || saveAllocations.isPending} onClick={() => saveAllocations.mutate()}>
              {saveAllocations.isPending ? "Saving…" : "Save allocations"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
