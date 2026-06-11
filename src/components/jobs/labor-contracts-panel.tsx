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
import {
  Trash2,
  Plus,
  HardHat,
  Pencil,
  FileText,
  FileSignature,
  Download,
  ClipboardList,
  Home,
} from "lucide-react";
import { TaskScheduleDialog } from "./task-schedule-dialog";

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

type LaborChangeOrder = {
  id: string;
  amount: string;
  reason: string | null;
  changeDate: string;
  changeNumber: number | null;
  scopeChange: string | null;
  addedScope: string | null;
  removedScope: string | null;
  timeAdjustmentDays: number | null;
  updatedPaymentTerms: string | null;
  paymentImpact: string | null;
  retainageImpact: string | null;
};

type GeneratedDoc = {
  id: string;
  documentType:
    | "LABOR_CONTRACT"
    | "INTERIOR_RENOVATION_LABOR_CONTRACT"
    | "CONTRACT_ADDENDUM";
  versionNumber: number;
  fileName: string;
  fileId: string | null;
  changeOrderId: string | null;
  generatedAt: string;
};

type ContractTask = { id: string };

type LaborContract = {
  id: string;
  crewId: string | null;
  label: string | null;
  contractAmount: string;
  description: string | null;
  paymentTerms: string | null;
  startDate: string | null;
  estimatedCompletionDate: string | null;
  contractorLicense: string | null;
  contractorInsurance: string | null;
  exclusions: string | null;
  notes: string | null;
  retainagePercent: string | null;
  delayDamagesPerDay: string | null;
  crew: { id: string; name: string } | null;
  createdBy: { firstName: string; lastName: string };
  payments: LaborPayment[];
  changeOrders: LaborChangeOrder[];
  generatedDocuments: GeneratedDoc[];
  tasks: ContractTask[];
};

const CONTRACT_DOC_TYPES = [
  "LABOR_CONTRACT",
  "INTERIOR_RENOVATION_LABOR_CONTRACT",
] as const;

function docTypeLabel(t: GeneratedDoc["documentType"]): string {
  if (t === "INTERIOR_RENOVATION_LABOR_CONTRACT") return "Interior reno";
  if (t === "CONTRACT_ADDENDUM") return "Addendum";
  return "Basic";
}

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function DocRow({ doc, showType }: { doc: GeneratedDoc; showType?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-[10px]">
          v{doc.versionNumber}
        </Badge>
        {showType && (
          <Badge variant="outline" className="text-[10px]">
            {docTypeLabel(doc.documentType)}
          </Badge>
        )}
        <span className="text-muted-foreground">
          {format(new Date(doc.generatedAt), "MMM d, yyyy h:mm a")}
        </span>
        <span className="truncate text-muted-foreground">{doc.fileName}</span>
      </div>
      {doc.fileId ? (
        <a
          href={`/api/files/${doc.fileId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-gray-100 hover:text-foreground"
          title="View / download PDF"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}

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
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editCompletionDate, setEditCompletionDate] = useState("");
  const [editLicense, setEditLicense] = useState("");
  const [editInsurance, setEditInsurance] = useState("");
  const [editExclusions, setEditExclusions] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRetainage, setEditRetainage] = useState("");
  const [editDelay, setEditDelay] = useState("");

  const openEdit = (c: LaborContract) => {
    setEditAmount(String(Number(c.contractAmount)));
    setEditDescription(c.description ?? "");
    setEditPaymentTerms(c.paymentTerms ?? "");
    setEditStartDate(toDateInput(c.startDate));
    setEditCompletionDate(toDateInput(c.estimatedCompletionDate));
    setEditLicense(c.contractorLicense ?? "");
    setEditInsurance(c.contractorInsurance ?? "");
    setEditExclusions(c.exclusions ?? "");
    setEditNotes(c.notes ?? "");
    setEditRetainage(c.retainagePercent != null ? String(Number(c.retainagePercent)) : "");
    setEditDelay(c.delayDamagesPerDay != null ? String(Number(c.delayDamagesPerDay)) : "");
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
          paymentTerms: editPaymentTerms || null,
          startDate: editStartDate || null,
          estimatedCompletionDate: editCompletionDate || null,
          contractorLicense: editLicense || null,
          contractorInsurance: editInsurance || null,
          exclusions: editExclusions || null,
          notes: editNotes || null,
          retainagePercent: editRetainage === "" ? null : Number(editRetainage),
          delayDamagesPerDay: editDelay === "" ? null : Number(editDelay),
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

  // Change-order dialog
  const [coContract, setCoContract] = useState<LaborContract | null>(null);
  const [coAmount, setCoAmount] = useState("");
  const [coDate, setCoDate] = useState(new Date().toISOString().slice(0, 10));
  const [coReason, setCoReason] = useState("");
  const [coAddedScope, setCoAddedScope] = useState("");
  const [coRemovedScope, setCoRemovedScope] = useState("");
  const [coTimeDays, setCoTimeDays] = useState("");
  const [coPaymentImpact, setCoPaymentImpact] = useState("");
  const [coRetainageImpact, setCoRetainageImpact] = useState("");

  const openChangeOrder = (c: LaborContract) => {
    setCoAmount("");
    setCoDate(new Date().toISOString().slice(0, 10));
    setCoReason("");
    setCoAddedScope("");
    setCoRemovedScope("");
    setCoTimeDays("");
    setCoPaymentImpact("");
    setCoRetainageImpact("");
    setCoContract(c);
  };

  const addChangeOrder = useMutation({
    mutationFn: async () => {
      if (!coContract) return;
      const res = await fetch(
        `/api/labor-contracts/${coContract.id}/change-orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(coAmount),
            changeDate: coDate,
            reason: coReason || null,
            addedScope: coAddedScope || null,
            removedScope: coRemovedScope || null,
            timeAdjustmentDays: coTimeDays ? Number(coTimeDays) : null,
            paymentImpact: coPaymentImpact || null,
            retainageImpact: coRetainageImpact || null,
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
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      setCoContract(null);
      toast.success("Change order added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeChangeOrder = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/labor-change-orders/${id}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      toast.success("Change order removed");
    },
  });

  // Parse a 422 missing-fields error into a readable message.
  async function readGenError(res: Response): Promise<string> {
    const err = await res.json().catch(() => ({}));
    if (res.status === 422 && Array.isArray(err.missingFields)) {
      return `Cannot generate — missing: ${err.missingFields.join(", ")}`;
    }
    return err.error || "Generation failed";
  }

  const generateContract = useMutation({
    mutationFn: async (contractId: string) => {
      const res = await fetch(
        `/api/labor-contracts/${contractId}/generate-contract`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readGenError(res));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      toast.success("Contract PDF generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateInteriorContract = useMutation({
    mutationFn: async (contractId: string) => {
      const res = await fetch(
        `/api/labor-contracts/${contractId}/generate-interior-contract`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readGenError(res));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      toast.success("Interior renovation contract PDF generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Task schedule dialog
  const [taskContract, setTaskContract] = useState<LaborContract | null>(null);

  const generateAddendum = useMutation({
    mutationFn: async (changeOrderId: string) => {
      const res = await fetch(
        `/api/labor-change-orders/${changeOrderId}/generate-addendum`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) throw new Error(await readGenError(res));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labor-contracts", jobId] });
      toast.success("Addendum PDF generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const coTotalFor = (c: LaborContract) =>
    c.changeOrders.reduce((s, co) => s + Number(co.amount), 0);
  // Revised contract = original + change orders.
  const revisedFor = (c: LaborContract) =>
    Number(c.contractAmount) + coTotalFor(c);
  const paidFor = (c: LaborContract) =>
    c.payments.reduce((s, p) => s + Number(p.amount), 0);

  const totals = useMemo(() => {
    let contracted = 0;
    let paid = 0;
    for (const c of contracts) {
      contracted +=
        Number(c.contractAmount) +
        c.changeOrders.reduce((s, co) => s + Number(co.amount), 0);
      for (const p of c.payments) paid += Number(p.amount);
    }
    return { contracted, paid, outstanding: contracted - paid };
  }, [contracts]);

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
            const coTotal = coTotalFor(c);
            const revised = revisedFor(c);
            const outstanding = revised - paid;
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
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        size="sm"
                        disabled={
                          generateInteriorContract.isPending &&
                          generateInteriorContract.variables === c.id
                        }
                        onClick={() => generateInteriorContract.mutate(c.id)}
                      >
                        <Home className="mr-1 h-4 w-4" />
                        {generateInteriorContract.isPending &&
                        generateInteriorContract.variables === c.id
                          ? "Generating…"
                          : "Interior reno contract"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTaskContract(c)}
                      >
                        <ClipboardList className="mr-1 h-4 w-4" />
                        Tasks
                        {c.tasks.length > 0 ? ` (${c.tasks.length})` : ""}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          generateContract.isPending &&
                          generateContract.variables === c.id
                        }
                        onClick={() => generateContract.mutate(c.id)}
                      >
                        <FileText className="mr-1 h-4 w-4" />
                        {generateContract.isPending &&
                        generateContract.variables === c.id
                          ? "Generating…"
                          : "Basic contract"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openChangeOrder(c)}
                      >
                        Change order
                      </Button>
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
                        {coTotal !== 0 ? "Revised contract" : "Contract"}
                      </div>
                      <div className="font-semibold">
                        ${revised.toLocaleString()}
                      </div>
                      {coTotal !== 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          orig ${Number(c.contractAmount).toLocaleString()}
                          {" · "}
                          {coTotal >= 0 ? "+" : "−"}$
                          {Math.abs(coTotal).toLocaleString()} change orders
                        </div>
                      )}
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

                  {(() => {
                    const contractDocs = c.generatedDocuments.filter((d) =>
                      (CONTRACT_DOC_TYPES as readonly string[]).includes(
                        d.documentType,
                      ),
                    );
                    if (contractDocs.length === 0) return null;
                    return (
                      <div className="space-y-1 border-t pt-2">
                        <div className="text-[10px] uppercase text-muted-foreground">
                          Contract PDFs
                        </div>
                        {contractDocs
                          .slice()
                          .sort((a, b) => b.versionNumber - a.versionNumber)
                          .map((d) => (
                            <DocRow key={d.id} doc={d} showType />
                          ))}
                      </div>
                    );
                  })()}

                  {c.changeOrders.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <div className="text-[10px] uppercase text-muted-foreground">
                        Change orders
                      </div>
                      {c.changeOrders.map((co) => {
                        const n = Number(co.amount);
                        const addendumDocs = c.generatedDocuments.filter(
                          (d) =>
                            d.documentType === "CONTRACT_ADDENDUM" &&
                            d.changeOrderId === co.id,
                        );
                        const genPending =
                          generateAddendum.isPending &&
                          generateAddendum.variables === co.id;
                        return (
                          <div key={co.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex flex-wrap items-center gap-2">
                                {co.changeNumber != null && (
                                  <span className="font-medium text-muted-foreground">
                                    CO #{co.changeNumber}
                                  </span>
                                )}
                                <span
                                  className={`font-medium ${
                                    n >= 0 ? "text-foreground" : "text-amber-700"
                                  }`}
                                >
                                  {n >= 0 ? "+" : "−"}$
                                  {Math.abs(n).toLocaleString()}
                                </span>
                                <span className="text-muted-foreground">
                                  {format(
                                    new Date(co.changeDate),
                                    "MMM d, yyyy",
                                  )}
                                </span>
                                {co.reason && (
                                  <span className="text-muted-foreground">
                                    · {co.reason}
                                  </span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-gray-100 hover:text-foreground disabled:opacity-50"
                                  title="Generate addendum PDF"
                                  disabled={genPending}
                                  onClick={() =>
                                    generateAddendum.mutate(co.id)
                                  }
                                >
                                  <FileSignature className="h-3.5 w-3.5" />
                                  {genPending ? "Generating…" : "Addendum"}
                                </button>
                                <button
                                  type="button"
                                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                                  title="Remove change order"
                                  onClick={() => {
                                    if (confirm("Remove this change order?"))
                                      removeChangeOrder.mutate(co.id);
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            {addendumDocs.length > 0 && (
                              <div className="ml-2 space-y-1 border-l pl-2">
                                {addendumDocs
                                  .slice()
                                  .sort(
                                    (a, b) =>
                                      b.versionNumber - a.versionNumber,
                                  )
                                  .map((d) => (
                                    <DocRow key={d.id} doc={d} />
                                  ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used verbatim as the Scope of Work on the generated contract.
              </p>
            </div>
            <div>
              <Label className="text-xs">Payment terms</Label>
              <Textarea
                rows={2}
                placeholder="e.g. 50% on start, balance on completion"
                value={editPaymentTerms}
                onChange={(e) => setEditPaymentTerms(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start date</Label>
                <Input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Est. completion</Label>
                <Input
                  type="date"
                  value={editCompletionDate}
                  onChange={(e) => setEditCompletionDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Contractor license #</Label>
                <Input
                  value={editLicense}
                  onChange={(e) => setEditLicense(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Insurance</Label>
                <Input
                  placeholder="Carrier / policy"
                  value={editInsurance}
                  onChange={(e) => setEditInsurance(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Exclusions</Label>
              <Textarea
                rows={2}
                placeholder="Work not included"
                value={editExclusions}
                onChange={(e) => setEditExclusions(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                placeholder="Any additional notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Retainage (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Default 10"
                  value={editRetainage}
                  onChange={(e) => setEditRetainage(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Delay damages ($/day)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Default 250"
                  value={editDelay}
                  onChange={(e) => setEditDelay(e.target.value)}
                />
              </div>
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

      {/* Change order dialog */}
      <Dialog
        open={Boolean(coContract)}
        onOpenChange={(o: boolean) => !o && setCoContract(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Change order
              {coContract
                ? ` — ${coContract.crew?.name ?? coContract.label ?? ""}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 2500 or -800"
                  value={coAmount}
                  onChange={(e) => setCoAmount(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Use a negative number for a credit.
                </p>
              </div>
              <div>
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={coDate}
                  onChange={(e) => setCoDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reason / description of change</Label>
              <Textarea
                rows={2}
                placeholder="What changed (extra demo, added scope, credit…)"
                value={coReason}
                onChange={(e) => setCoReason(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Added scope</Label>
                <Textarea
                  rows={2}
                  placeholder="Scope added by this change order"
                  value={coAddedScope}
                  onChange={(e) => setCoAddedScope(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Removed scope</Label>
                <Textarea
                  rows={2}
                  placeholder="Scope removed by this change order"
                  value={coRemovedScope}
                  onChange={(e) => setCoRemovedScope(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Time adjustment (days)</Label>
                <Input
                  type="number"
                  step="1"
                  placeholder="e.g. 5 or -2"
                  value={coTimeDays}
                  onChange={(e) => setCoTimeDays(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Payment impact</Label>
                <Input
                  placeholder="Optional"
                  value={coPaymentImpact}
                  onChange={(e) => setCoPaymentImpact(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Retainage impact</Label>
                <Input
                  placeholder="Optional"
                  value={coRetainageImpact}
                  onChange={(e) => setCoRetainageImpact(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              After saving, use the <span className="font-medium">Addendum</span>{" "}
              button on the change order to generate a PDF.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCoContract(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                !coAmount || Number(coAmount) === 0 || addChangeOrder.isPending
              }
              onClick={() => addChangeOrder.mutate()}
            >
              {addChangeOrder.isPending ? "Saving…" : "Add change order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task & payment schedule dialog */}
      {taskContract && (
        <TaskScheduleDialog
          jobId={jobId}
          contractId={taskContract.id}
          contractName={
            taskContract.crew?.name ?? taskContract.label ?? "Labor"
          }
          retainagePercent={
            taskContract.retainagePercent != null
              ? Number(taskContract.retainagePercent)
              : 10
          }
          open={Boolean(taskContract)}
          onClose={() => setTaskContract(null)}
        />
      )}
    </div>
  );
}
