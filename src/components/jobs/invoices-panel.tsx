"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Plus } from "lucide-react";

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
  payments: InvoicePayment[];
  changeOrder: { number: number } | null;
};

const STATUSES = ["DRAFT", "SENT", "PAID", "VOID"] as const;

export function InvoicesPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/invoices`).then((r) => r.json()),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Create failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", jobId] });
      toast.success("Invoice created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", jobId] });
    },
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus className="mr-2 h-4 w-4" />
          {create.isPending ? "Creating…" : "New Invoice (balance due)"}
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No invoices yet.
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-sm font-medium">
                      {inv.invoiceNumber}
                    </span>
                    <span className="text-sm font-medium">
                      ${Number(inv.amount).toLocaleString()}
                    </span>
                    <Badge
                      variant={
                        inv.status === "PAID"
                          ? "default"
                          : inv.status === "VOID"
                            ? "secondary"
                            : "outline"
                      }
                      className="text-[10px]"
                    >
                      {inv.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Issued {format(new Date(inv.issueDate), "MMM d, yyyy")}
                    {inv.dueDate &&
                      ` · Due ${format(new Date(inv.dueDate), "MMM d, yyyy")}`}
                    {inv.changeOrder && ` · from CO-${inv.changeOrder.number}`}
                  </div>
                  {inv.payments.length > 0 && (
                    <div className="mt-1 text-xs text-green-700">
                      Paid ${paidTotal(inv).toLocaleString()} of $
                      {Number(inv.amount).toLocaleString()}
                      {" · "}
                      {inv.payments.length} payment
                      {inv.payments.length > 1 ? "s" : ""}
                      {inv.paidAt &&
                        ` · settled ${format(new Date(inv.paidAt), "MMM d, yyyy")}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={inv.status}
                    onValueChange={(v: string | null) =>
                      v && changeStatus(inv, v)
                    }
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
          ))}
        </div>
      )}
    </div>
  );
}
