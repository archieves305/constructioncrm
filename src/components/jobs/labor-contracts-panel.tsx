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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, HardHat, Pencil } from "lucide-react";

const METHODS = [
  "CHECK",
  "CARD",
  "ACH",
  "CASH",
  "FINANCING",
  "WIRE",
  "OTHER",
] as const;

type LaborPayment = {
  id: string;
  amount: string;
  paidDate: string;
  method: (typeof METHODS)[number] | null;
  reference: string | null;
  notes: string | null;
};

type LaborContract = {
  id: string;
  crewId: string | null;
  label: string | null;
  contractAmount: string;
  description: string | null;
  crew: { id: string; name: string } | null;
  createdBy: { firstName: string; lastName: string };
  payments: LaborPayment[];
};

type Crew = { id: string; name: string; isActive: boolean };

const ADHOC = "__adhoc";

export function LaborContractsPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();

  const { data: contracts = [], isLoading } = useQuery<LaborContract[]>({
    queryKey: ["labor-contracts", jobId],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/labor-contracts`).then((r) => r.json()),
  });

  const { data: crews = [] } = useQuery<Crew[]>({
    queryKey: ["crews", "active"],
    queryFn: () => fetch("/api/crews?activeOnly=true").then((r) => r.json()),
  });

  // Add-contract form
  const [crewChoice, setCrewChoice] = useState<string>(""); // crewId or ADHOC
  const [adhocName, setAdhocName] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = () => {
    setCrewChoice("");
    setAdhocName("");
    setAmount("");
    setDescription("");
  };

  const create = useMutation({
    mutationFn: async () => {
      const isAdhoc = crewChoice === ADHOC;
      const res = await fetch(`/api/jobs/${jobId}/labor-contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewId: isAdhoc ? null : crewChoice || null,
          label: isAdhoc ? adhocName : null,
          contractAmount: Number(amount),
          description: description || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      resetForm();
      toast.success("Labor contract added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeContract = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/labor-contracts/${id}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      toast.success("Labor contract removed");
    },
  });

  // Edit-contract dialog
  const [editing, setEditing] = useState<LaborContract | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const openEdit = (c: LaborContract) => {
    setEditAmount(String(Number(c.contractAmount)));
    setEditDescription(c.description ?? "");
    setEditing(c);
  };

  const updateContract = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const res = await fetch(`/api/labor-contracts/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractAmount: Number(editAmount),
          description: editDescription || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      setEditing(null);
      toast.success("Labor contract updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Record-payment dialog
  const [payingContract, setPayingContract] = useState<LaborContract | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<(typeof METHODS)[number] | "">("");
  const [payReference, setPayReference] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const openPay = (c: LaborContract) => {
    setPayAmount("");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod("");
    setPayReference("");
    setPayNotes("");
    setPayingContract(c);
  };

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!payingContract) return;
      const res = await fetch(
        `/api/labor-contracts/${payingContract.id}/payments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(payAmount),
            paidDate: payDate,
            method: payMethod || null,
            reference: payReference || null,
            notes: payNotes || null,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      setPayingContract(null);
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removePayment = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/labor-payments/${id}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      toast.success("Payment deleted");
    },
  });

  const totals = useMemo(() => {
    let contracted = 0;
    let paid = 0;
    for (const c of contracts) {
      contracted += Number(c.contractAmount);
      for (const p of c.payments) paid += Number(p.amount);
    }
    return { contracted, paid, outstanding: contracted - paid };
  }, [contracts]);

  const paidFor = (c: LaborContract) =>
    c.payments.reduce((s, p) => s + Number(p.amount), 0);

  const canAdd =
    amount &&
    Number(amount) > 0 &&
    (crewChoice === ADHOC ? adhocName.trim().length > 0 : Boolean(crewChoice));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Labor contracts
            </div>
            <div className="text-lg font-semibold">
              ${totals.contracted.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Paid to date
            </div>
            <div className="text-lg font-semibold text-emerald-700">
              ${totals.paid.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">
              Outstanding
            </div>
            <div
              className={`text-lg font-semibold ${
                totals.outstanding > 0 ? "text-red-700" : "text-emerald-700"
              }`}
            >
              ${totals.outstanding.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add contract */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Crew</Label>
              <Select
                value={crewChoice || "__none"}
                onValueChange={(v: string | null) =>
                  setCrewChoice(!v || v === "__none" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select crew">
                    {(v: string) =>
                      !v || v === "__none"
                        ? "Select crew"
                        : v === ADHOC
                          ? "Other (type a name)"
                          : crews.find((c) => c.id === v)?.name || "Select crew"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {crews.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={ADHOC}>+ Other (type a name)…</SelectItem>
                </SelectContent>
              </Select>
              {crewChoice === ADHOC && (
                <Input
                  className="mt-2"
                  placeholder="e.g. Roofer – ABC Co"
                  value={adhocName}
                  onChange={(e) => setAdhocName(e.target.value)}
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Contract price ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex flex-col justify-end">
              <Button
                size="sm"
                disabled={!canAdd || create.isPending}
                onClick={() => create.mutate()}
              >
                <Plus className="mr-1 h-4 w-4" />
                {create.isPending ? "Saving…" : "Add labor contract"}
              </Button>
            </div>
          </div>
          <Textarea
            placeholder="Scope / description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : contracts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No labor contracts yet. Add a crew and its contract price above.
        </p>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => {
            const paid = paidFor(c);
            const outstanding = Number(c.contractAmount) - paid;
            const name = c.crew?.name ?? c.label ?? "Labor";
            return (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <HardHat className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{name}</span>
                      {!c.crew && (
                        <Badge variant="secondary" className="text-[10px]">
                          ad-hoc
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openPay(c)}
                      >
                        Record payment
                      </Button>
                      <button
                        type="button"
                        className="rounded p-2 text-muted-foreground hover:bg-gray-100 hover:text-foreground"
                        title="Edit contract"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                        title="Remove contract"
                        onClick={() => {
                          if (
                            confirm(
                              "Remove this labor contract and its payments?",
                            )
                          )
                            removeContract.mutate(c.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        Contract
                      </div>
                      <div className="font-semibold">
                        ${Number(c.contractAmount).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        Paid
                      </div>
                      <div className="font-semibold text-emerald-700">
                        ${paid.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        Outstanding
                      </div>
                      <div
                        className={`font-semibold ${
                          outstanding > 0 ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        ${outstanding.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {c.description && (
                    <div className="text-xs text-muted-foreground">
                      {c.description}
                    </div>
                  )}

                  {c.payments.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      {c.payments.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              ${Number(p.amount).toLocaleString()}
                            </span>
                            {p.method && (
                              <Badge variant="secondary" className="text-[10px]">
                                {p.method}
                              </Badge>
                            )}
                            {p.reference && (
                              <span className="text-muted-foreground">
                                #{p.reference}
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {format(new Date(p.paidDate), "MMM d, yyyy")}
                            </span>
                            {p.notes && (
                              <span className="text-muted-foreground">
                                · {p.notes}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                            title="Delete payment"
                            onClick={() => {
                              if (confirm("Delete this payment?"))
                                removePayment.mutate(p.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit contract dialog */}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(o: boolean) => !o && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit labor contract
              {editing
                ? ` — ${editing.crew?.name ?? editing.label ?? ""}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Contract price ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Scope / description</Label>
              <Textarea
                rows={2}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                !editAmount || Number(editAmount) < 0 || updateContract.isPending
              }
              onClick={() => updateContract.mutate()}
            >
              {updateContract.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog
        open={Boolean(payingContract)}
        onOpenChange={(o: boolean) => !o && setPayingContract(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Record payment
              {payingContract
                ? ` — ${payingContract.crew?.name ?? payingContract.label ?? ""}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Amount ($)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Method</Label>
                <Select
                  value={payMethod || "__none"}
                  onValueChange={(v: string | null) =>
                    setPayMethod(
                      v && v !== "__none"
                        ? (v as (typeof METHODS)[number])
                        : "",
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—">
                      {(v: string) => (!v || v === "__none" ? "—" : v)}
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
              <div>
                <Label className="text-xs">Check # / ref.</Label>
                <Input
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPayingContract(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                !payAmount || Number(payAmount) <= 0 || recordPayment.isPending
              }
              onClick={() => recordPayment.mutate()}
            >
              {recordPayment.isPending ? "Saving…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
