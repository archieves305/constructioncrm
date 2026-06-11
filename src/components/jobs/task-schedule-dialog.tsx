"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2, Plus } from "lucide-react";

export type ContractTask = {
  id: string;
  sortOrder: number;
  name: string;
  room: string | null;
  description: string | null;
  paymentAmount: string | null;
  paymentPercent: string | null;
  inspectionRequired: boolean;
  inspectionStatus: string;
  status: string;
  approvedBy: string | null;
  approvedDate: string | null;
  notes: string | null;
};

const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE"] as const;
const INSPECTION_OPTIONS = ["PENDING", "PASSED", "FAILED", "NA"] as const;

const EXAMPLE_TASKS = [
  "Demolition",
  "Framing",
  "Electrical rough-in",
  "Plumbing rough-in",
  "Window installation",
  "Door installation",
  "Drywall installation",
  "Drywall finishing",
  "Bathroom waterproofing",
  "Tile installation",
  "Flooring installation",
  "Trim/baseboard installation",
  "Cabinet installation",
  "Painting",
  "Final punch list",
  "Final cleanup",
];

function money(n: number) {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(s: string) {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function TaskScheduleDialog({
  jobId,
  contractId,
  contractName,
  retainagePercent,
  open,
  onClose,
}: {
  jobId: string;
  contractId: string;
  contractName: string;
  retainagePercent: number;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery<ContractTask[]>({
    queryKey: ["labor-contract-tasks", contractId],
    queryFn: () =>
      fetch(`/api/labor-contracts/${contractId}/tasks`).then((r) => r.json()),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["labor-contract-tasks", contractId] });
    qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
  };

  const [newName, setNewName] = useState("");

  const addTask = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/labor-contracts/${contractId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setNewName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateTask = useMutation({
    mutationFn: async (vars: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/labor-contract-tasks/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/labor-contract-tasks/${id}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => invalidate(),
  });

  const save = (id: string, field: string, value: unknown) =>
    updateTask.mutate({ id, data: { [field]: value } });

  const num = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Payment summary: approved = completed and (no inspection required or passed).
  const [backcharges, setBackcharges] = useState("");
  const [directPayments, setDirectPayments] = useState("");

  const summary = useMemo(() => {
    const gross = tasks.reduce((s, t) => {
      const approved =
        t.status === "COMPLETE" &&
        (!t.inspectionRequired || t.inspectionStatus === "PASSED");
      return approved ? s + Number(t.paymentAmount ?? 0) : s;
    }, 0);
    const retainage = (gross * retainagePercent) / 100;
    const bc = Number(backcharges) || 0;
    const dp = Number(directPayments) || 0;
    const net = gross - retainage - bc - dp;
    return { gross, retainage, bc, dp, net };
  }, [tasks, retainagePercent, backcharges, directPayments]);

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Task &amp; payment schedule — {contractName}</DialogTitle>
        </DialogHeader>

        {/* Add task */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="New task name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim())
                  addTask.mutate(newName.trim());
              }}
            />
            <Button
              size="sm"
              disabled={!newName.trim() || addTask.isPending}
              onClick={() => addTask.mutate(newName.trim())}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {EXAMPLE_TASKS.map((t) => (
              <button
                key={t}
                type="button"
                className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-gray-100 hover:text-foreground"
                onClick={() => addTask.mutate(t)}
              >
                + {t}
              </button>
            ))}
          </div>
        </div>

        {/* Task list */}
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No tasks yet. Add tasks above to build the payment schedule.
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <Card key={t.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      className="font-medium"
                      defaultValue={t.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== t.name) save(t.id, "name", v);
                      }}
                    />
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      title="Delete task"
                      onClick={() => {
                        if (confirm("Delete this task?")) deleteTask.mutate(t.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <Label className="text-[10px]">Room / area</Label>
                      <Input
                        defaultValue={t.room ?? ""}
                        onBlur={(e) =>
                          save(t.id, "room", e.target.value.trim() || null)
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Amount ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={
                          t.paymentAmount != null ? Number(t.paymentAmount) : ""
                        }
                        onBlur={(e) =>
                          save(t.id, "paymentAmount", num(e.target.value))
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Percent (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={
                          t.paymentPercent != null
                            ? Number(t.paymentPercent)
                            : ""
                        }
                        onBlur={(e) =>
                          save(t.id, "paymentPercent", num(e.target.value))
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Status</Label>
                      <Select
                        value={t.status}
                        onValueChange={(v: string | null) =>
                          v && save(t.id, "status", v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) => label(v || t.status)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {label(s)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <Label className="text-[10px]">Inspection req.</Label>
                      <Select
                        value={t.inspectionRequired ? "yes" : "no"}
                        onValueChange={(v: string | null) =>
                          v &&
                          save(t.id, "inspectionRequired", v === "yes")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) =>
                              (v || (t.inspectionRequired ? "yes" : "no")) ===
                              "yes"
                                ? "Yes"
                                : "No"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Inspection status</Label>
                      <Select
                        value={t.inspectionStatus}
                        onValueChange={(v: string | null) =>
                          v && save(t.id, "inspectionStatus", v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) => v || t.inspectionStatus}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {INSPECTION_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Approved by</Label>
                      <Input
                        defaultValue={t.approvedBy ?? ""}
                        onBlur={(e) =>
                          save(t.id, "approvedBy", e.target.value.trim() || null)
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Approved date</Label>
                      <Input
                        type="date"
                        defaultValue={t.approvedDate?.slice(0, 10) ?? ""}
                        onBlur={(e) =>
                          save(t.id, "approvedDate", e.target.value || null)
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px]">Description / notes</Label>
                    <Input
                      defaultValue={t.description ?? ""}
                      onBlur={(e) =>
                        save(t.id, "description", e.target.value.trim() || null)
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Weekly payment summary */}
        <Card>
          <CardContent className="space-y-2 p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Weekly payment calculation (approved tasks)
            </div>
            <div className="flex justify-between text-sm">
              <span>Gross approved</span>
              <span className="font-semibold">{money(summary.gross)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Less {retainagePercent}% retainage</span>
              <span>−{money(summary.retainage)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Backcharges / offsets ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={backcharges}
                  onChange={(e) => setBackcharges(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Direct payments ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={directPayments}
                  onChange={(e) => setDirectPayments(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-between border-t pt-2 text-sm">
              <span className="font-semibold">Net due to contractor</span>
              <span
                className={`font-semibold ${
                  summary.net >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {money(summary.net)}
              </span>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
