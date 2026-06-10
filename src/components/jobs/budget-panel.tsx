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
import { Trash2, Plus, Upload, Download, Pencil, HardHat, Receipt } from "lucide-react";

type LinkedExpense = {
  id: string;
  vendor: string | null;
  type: string;
  amount: string;
};
type LinkedLabor = {
  id: string;
  label: string | null;
  contractAmount: string;
  crew: { name: string } | null;
  changeOrders: { amount: string }[];
};
type BudgetLine = {
  id: string;
  category: string | null;
  name: string;
  amount: string;
  expenses: LinkedExpense[];
  laborContracts: LinkedLabor[];
};

type Expense = {
  id: string;
  vendor: string | null;
  type: string;
  amount: string;
  budgetLineId: string | null;
};
type LaborContract = {
  id: string;
  label: string | null;
  contractAmount: string;
  crew: { name: string } | null;
  changeOrders: { amount: string }[];
  budgetLineId: string | null;
};

const UNASSIGNED = "__unassigned";

const laborRevised = (c: {
  contractAmount: string;
  changeOrders: { amount: string }[];
}) =>
  Number(c.contractAmount) +
  c.changeOrders.reduce((s, co) => s + Number(co.amount), 0);

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
    if (lines.length > 0) {
      if (
        !confirm(
          "Uploading replaces the current budget and clears expense/labor links to its lines. Continue?",
        )
      ) {
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
    }
    importFile.mutate(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Add / edit / delete a line
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

  // Assign an expense / labor contract to a line
  const assignExpense = useMutation({
    mutationFn: ({ id, budgetLineId }: { id: string; budgetLineId: string | null }) =>
      fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetLineId }),
      }).then((r) => r.json()),
    onSuccess: () => invalidateAll(),
  });
  const assignLabor = useMutation({
    mutationFn: ({ id, budgetLineId }: { id: string; budgetLineId: string | null }) =>
      fetch(`/api/labor-contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetLineId }),
      }).then((r) => r.json()),
    onSuccess: () => invalidateAll(),
  });

  const actualFor = (l: BudgetLine) =>
    l.expenses.reduce((s, e) => s + Number(e.amount), 0) +
    l.laborContracts.reduce((s, c) => s + laborRevised(c), 0);

  const { totalBudget, linkedSpend } = useMemo(() => {
    let totalBudget = 0;
    let linkedSpend = 0;
    for (const l of lines) {
      totalBudget += Number(l.amount);
      linkedSpend += actualFor(l);
    }
    return { totalBudget, linkedSpend };
  }, [lines]);

  const variance = totalBudget - totalJobCost;
  const unbudgeted = totalJobCost - linkedSpend;

  const lineName = (l: BudgetLine) =>
    l.category ? `${l.category} · ${l.name}` : l.name;

  const canAddLine = newName.trim() && newAmount && Number(newAmount) >= 0;

  if (isLoading)
    return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;

  // ── Empty state ──────────────────────────────────────────────────────────
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
              <Input
                placeholder="Category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <Input
                placeholder="Line item"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Budget $"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!canAddLine || addLine.isPending}
                onClick={() => addLine.mutate()}
              >
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Loaded state ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Total budget
            </div>
            <div className="text-lg font-semibold">
              ${totalBudget.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Spent (job cost)
            </div>
            <div className="text-lg font-semibold">
              ${totalJobCost.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              {variance >= 0 ? "Under budget" : "Over budget"}
            </div>
            <div
              className={`text-lg font-semibold ${
                variance >= 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              ${Math.abs(variance).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Unbudgeted spend
            </div>
            <div
              className={`text-lg font-semibold ${
                unbudgeted > 0.005 ? "text-amber-700" : "text-muted-foreground"
              }`}
            >
              ${unbudgeted.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={importFile.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-1 h-4 w-4" />
          {importFile.isPending ? "Importing…" : "Re-upload (replace)"}
        </Button>
        <a
          href={`/api/jobs/${jobId}/budget/template`}
          className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
        >
          <Download className="h-3 w-3" />
          Template
        </a>
      </div>

      {/* Budget lines */}
      <div className="space-y-2">
        {lines.map((l) => {
          const budget = Number(l.amount);
          const actual = actualFor(l);
          const v = budget - actual;
          return (
            <Card key={l.id}>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {l.category && (
                      <Badge variant="outline" className="text-[10px]">
                        {l.category}
                      </Badge>
                    )}
                    <span className="text-sm font-medium">{l.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-foreground"
                      title="Edit line"
                      onClick={() => startEdit(l)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                      title="Remove line"
                      onClick={() => {
                        if (confirm("Remove this budget line?"))
                          deleteLine.mutate(l.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Budget
                    </div>
                    <div className="font-semibold">
                      ${budget.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Actual
                    </div>
                    <div className="font-semibold">
                      ${actual.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {v >= 0 ? "Under" : "Over"}
                    </div>
                    <div
                      className={`font-semibold ${
                        v >= 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      ${Math.abs(v).toLocaleString()}
                    </div>
                  </div>
                </div>
                {(l.expenses.length > 0 || l.laborContracts.length > 0) && (
                  <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                    {l.laborContracts.map((c) => (
                      <div key={c.id} className="flex items-center gap-2">
                        <HardHat className="h-3 w-3" />
                        {c.crew?.name ?? c.label ?? "Labor"} — $
                        {laborRevised(c).toLocaleString()}
                      </div>
                    ))}
                    {l.expenses.map((e) => (
                      <div key={e.id} className="flex items-center gap-2">
                        <Receipt className="h-3 w-3" />
                        {e.vendor || e.type.replace(/_/g, " ")} — $
                        {Number(e.amount).toLocaleString()}
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
            <Input
              placeholder="Category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
            <Input
              placeholder="Line item"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="Budget $"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!canAddLine || addLine.isPending}
              onClick={() => addLine.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Assignment: link spend to budget lines */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-medium">Assign spend to budget lines</p>

          {laborContracts.length === 0 && expenses.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No expenses or labor contracts to assign yet.
            </p>
          )}

          {laborContracts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <HardHat className="h-4 w-4 text-muted-foreground" />
                <span>{c.crew?.name ?? c.label ?? "Labor"}</span>
                <span className="font-medium">
                  ${laborRevised(c).toLocaleString()}
                </span>
              </div>
              <Select
                value={c.budgetLineId || UNASSIGNED}
                onValueChange={(v: string | null) =>
                  assignLabor.mutate({
                    id: c.id,
                    budgetLineId: !v || v === UNASSIGNED ? null : v,
                  })
                }
              >
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue>
                    {(v: string) =>
                      !v || v === UNASSIGNED
                        ? "— Unassigned —"
                        : lineName(
                            lines.find((l) => l.id === v) ?? ({} as BudgetLine),
                          ) || "—"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>— Unassigned —</SelectItem>
                  {lines.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {lineName(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}

          {expenses.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="text-[10px]">
                  {e.type.replace(/_/g, " ")}
                </Badge>
                <span>{e.vendor || "—"}</span>
                <span className="font-medium">
                  ${Number(e.amount).toLocaleString()}
                </span>
              </div>
              <Select
                value={e.budgetLineId || UNASSIGNED}
                onValueChange={(v: string | null) =>
                  assignExpense.mutate({
                    id: e.id,
                    budgetLineId: !v || v === UNASSIGNED ? null : v,
                  })
                }
              >
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue>
                    {(v: string) =>
                      !v || v === UNASSIGNED
                        ? "— Unassigned —"
                        : lineName(
                            lines.find((l) => l.id === v) ?? ({} as BudgetLine),
                          ) || "—"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>— Unassigned —</SelectItem>
                  {lines.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {lineName(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Edit line dialog (inline simple) */}
      {editing && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-xs font-medium">Edit budget line</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <Input
                placeholder="Category"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              />
              <Input
                placeholder="Line item"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  disabled={!editName.trim() || saveEdit.isPending}
                  onClick={() => saveEdit.mutate()}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
