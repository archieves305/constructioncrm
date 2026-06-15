"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
  Plus,
  Send,
  Trash2,
  Pencil,
  Copy,
  FileText,
  Link2,
  Gavel,
} from "lucide-react";

type ChangeOrder = {
  id: string;
  number: number;
  title: string | null;
  description: string | null;
  customerPrice: string;
  crewCost: string | null;
  status: "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "VOID";
  token: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  decisionName: string | null;
  rejectionReason: string | null;
  laborContractId: string | null;
  invoice: { id: string; invoiceNumber: string; status: string } | null;
  laborContract: {
    id: string;
    label: string | null;
    crew: { name: string } | null;
  } | null;
};

type LaborContractOption = {
  id: string;
  label: string | null;
  crew: { name: string } | null;
};

const STATUS_STYLES: Record<ChangeOrder["status"], string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SENT: "bg-blue-100 text-blue-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  VOID: "bg-gray-100 text-gray-400",
};

function money(v: string | number | null) {
  if (v == null) return "—";
  return `$${Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function contractName(c: LaborContractOption) {
  return c.crew?.name ?? c.label ?? "Labor";
}

const NO_CREW = "__none";

export function ChangeOrdersPanel({
  jobId,
  jobType,
}: {
  jobId: string;
  jobType: string;
}) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canDecide =
    session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChangeOrder | null>(null);
  const [decideFor, setDecideFor] = useState<ChangeOrder | null>(null);
  const [decideName, setDecideName] = useState("");
  const [decideReason, setDecideReason] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerPrice, setCustomerPrice] = useState("");
  const [crewCost, setCrewCost] = useState("");
  const [laborContractId, setLaborContractId] = useState<string>(NO_CREW);

  const { data: changeOrders = [], isLoading } = useQuery<ChangeOrder[]>({
    queryKey: ["change-orders", jobId],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/change-orders`).then((r) => r.json()),
  });

  const { data: contracts = [] } = useQuery<LaborContractOption[]>({
    queryKey: ["labor-contracts", jobId],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/labor-contracts`).then((r) => r.json()),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["change-orders", jobId] });

  function resetForm() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setCustomerPrice("");
    setCrewCost("");
    setLaborContractId(NO_CREW);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(co: ChangeOrder) {
    setEditing(co);
    setTitle(co.title ?? "");
    setDescription(co.description ?? "");
    setCustomerPrice(co.customerPrice);
    setCrewCost(co.crewCost ?? "");
    setLaborContractId(co.laborContractId ?? NO_CREW);
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim() || null,
        description: description.trim() || null,
        customerPrice: Number(customerPrice),
        crewCost: crewCost.trim() ? Number(crewCost) : null,
        laborContractId: laborContractId === NO_CREW ? null : laborContractId,
      };
      const url = editing
        ? `/api/change-orders/${editing.id}`
        : `/api/jobs/${jobId}/change-orders`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Save failed");
    },
    onSuccess: () => {
      toast.success(editing ? "Change order updated" : "Change order created");
      setDialogOpen(false);
      resetForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/change-orders/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error || "Delete failed");
    },
    onSuccess: () => {
      toast.success("Change order deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/change-orders/${id}/send`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Send failed");
      return res.json() as Promise<{ emailed: boolean }>;
    },
    onSuccess: (data) => {
      toast.success(
        data.emailed
          ? "Change order emailed to customer"
          : "Marked sent — email not configured, share the link",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordDecision = useMutation({
    mutationFn: async (decision: "APPROVE" | "REJECT") => {
      if (!decideFor) return;
      const res = await fetch(`/api/change-orders/${decideFor.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          name: decideName.trim() || null,
          reason: decision === "REJECT" ? decideReason.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 403
            ? "Only Admin/Manager can record a decision"
            : body?.error || "Failed to record decision",
        );
      }
    },
    onSuccess: (_data, decision) => {
      toast.success(
        decision === "APPROVE"
          ? "Change order approved — customer billed"
          : "Change order rejected",
      );
      setDecideFor(null);
      setDecideName("");
      setDecideReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openDecision(co: ChangeOrder) {
    setDecideFor(co);
    setDecideName("");
    setDecideReason("");
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/co/${token}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Customer link copied"),
      () => toast.error("Could not copy link"),
    );
  }

  const priceValid = Number(customerPrice) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">
          Change Orders ({changeOrders.length})
        </h3>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> New change order
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : changeOrders.length === 0 ? (
        <p className="text-sm text-gray-400">
          No change orders yet. Create one to bill the customer for added scope.
        </p>
      ) : (
        <div className="space-y-2">
          {changeOrders.map((co) => (
            <Card key={co.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">CO-{co.number}</span>
                      {co.title ? (
                        <span className="text-gray-600">— {co.title}</span>
                      ) : null}
                      <Badge className={STATUS_STYLES[co.status]}>
                        {co.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Customer price{" "}
                      <span className="font-semibold text-gray-900">
                        {money(co.customerPrice)}
                      </span>
                      {co.crewCost != null && (
                        <> · crew cost {money(co.crewCost)}</>
                      )}
                      {co.laborContract && (
                        <> · {contractName(co.laborContract)}</>
                      )}
                    </div>
                    {co.description ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
                        {co.description}
                      </p>
                    ) : null}
                    {co.status === "APPROVED" && co.invoice && (
                      <div className="mt-1 flex items-center gap-1 text-sm text-green-700">
                        <FileText className="h-3.5 w-3.5" />
                        Invoice {co.invoice.invoiceNumber}
                        {co.decisionName ? ` · approved by ${co.decisionName}` : ""}
                        {co.decidedAt
                          ? ` on ${format(new Date(co.decidedAt), "MMM d, yyyy")}`
                          : ""}
                      </div>
                    )}
                    {co.status === "REJECTED" && (
                      <div className="mt-1 text-sm text-red-700">
                        Rejected
                        {co.decisionName ? ` by ${co.decisionName}` : ""}
                        {co.rejectionReason ? `: ${co.rejectionReason}` : ""}
                      </div>
                    )}
                    {co.status === "SENT" && co.sentAt && (
                      <div className="mt-1 text-sm text-blue-700">
                        Sent {format(new Date(co.sentAt), "MMM d, yyyy")} —
                        awaiting customer response
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {co.status === "DRAFT" && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(co)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Delete this change order?"))
                              remove.mutate(co.id);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {(co.status === "DRAFT" || co.status === "SENT") && (
                      <Button
                        size="sm"
                        variant={co.status === "SENT" ? "outline" : "default"}
                        onClick={() => send.mutate(co.id)}
                        disabled={send.isPending}
                      >
                        <Send className="mr-1 h-4 w-4" />
                        {co.status === "SENT" ? "Resend" : "Send to customer"}
                      </Button>
                    )}
                    {canDecide &&
                      (co.status === "DRAFT" || co.status === "SENT") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDecision(co)}
                          title="Record a decision made in a meeting"
                        >
                          <Gavel className="mr-1 h-4 w-4" />
                          Record decision
                        </Button>
                      )}
                    {co.token &&
                      (co.status === "SENT" ||
                        co.status === "APPROVED" ||
                        co.status === "REJECTED") && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => copyLink(co.token!)}
                          title="Copy customer link"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!decideFor}
        onOpenChange={(open) => !open && setDecideFor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Record decision{decideFor ? ` — CO-${decideFor.number}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Use this when the customer approved or rejected the change order in
              person, by phone, or in a meeting. Approving here bills the customer
              just like the emailed link.
            </p>
            <div>
              <Label>Approved/rejected by</Label>
              <Input
                value={decideName}
                onChange={(e) => setDecideName(e.target.value)}
                placeholder="Customer name (defaults to you)"
              />
            </div>
            <div>
              <Label>Reason (for rejection)</Label>
              <Textarea
                rows={2}
                value={decideReason}
                onChange={(e) => setDecideReason(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => recordDecision.mutate("REJECT")}
              disabled={recordDecision.isPending}
            >
              Reject
            </Button>
            <Button
              onClick={() => recordDecision.mutate("APPROVE")}
              disabled={recordDecision.isPending}
            >
              Approve &amp; bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit CO-${editing.number}` : "New change order"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Add bathroom tile"
              />
            </div>
            <div>
              <Label>Scope / description (shown to customer)</Label>
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the additional work"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Customer price *</Label>
                <Input
                  inputMode="decimal"
                  value={customerPrice}
                  onChange={(e) => setCustomerPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Crew cost (internal)</Label>
                <Input
                  inputMode="decimal"
                  value={crewCost}
                  onChange={(e) => setCrewCost(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>
            <div>
              <Label>Linked crew contract (optional)</Label>
              <Select
                value={laborContractId}
                onValueChange={(v: string | null) =>
                  setLaborContractId(v ?? NO_CREW)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CREW}>None</SelectItem>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {contractName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-gray-400">
                <Link2 className="mr-1 inline h-3 w-3" />
                When set with a crew cost, approval also files a labor change
                order so crew totals stay correct.
              </p>
            </div>
            {!["FIXED_PRICE"].includes(jobType) && (
              <p className="text-xs text-amber-600">
                This is a {jobType.replace("_", "-").toLowerCase()} job — the
                contract is recomputed from crew cost on approval. Set a crew
                cost and linked contract so the customer price flows through.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!priceValid || save.isPending}
            >
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
