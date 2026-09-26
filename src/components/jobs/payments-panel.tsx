"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchJson } from "@/lib/fetch-json";

export type JobPayment = {
  id: string;
  paymentType: string;
  method: string | null;
  reference: string | null;
  amount: string;
  status: string;
  receivedDate: string | null;
  notes: string | null;
};

/** Record a payment against the job (optionally an invoice) and list what has come in. Moved out of the job page verbatim. */
export function PaymentsPanel({ jobId, payments }: { jobId: string; payments: JobPayment[] }) {
  const qc = useQueryClient();
  const [payAmount, setPayAmount] = useState("");
  const [payType, setPayType] = useState("DEPOSIT");
  const [payMethod, setPayMethod] = useState("CHECK");
  const [payReference, setPayReference] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState("__none");

  const { data: jobInvoices = [] } = useQuery<{ id: string; invoiceNumber: string; amount: string; status: string }[]>({
    queryKey: ["invoices", jobId],
    queryFn: () => fetchJson(`/api/jobs/${jobId}/invoices`),
  });
  const openInvoices = jobInvoices.filter((inv) => inv.status !== "PAID" && inv.status !== "VOID");

  const refreshFinancials = () => {
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["invoices", jobId] });
  };

  const recordPayment = useMutation({
    mutationFn: (data: { paymentType: string; amount: number; method: string; reference: string; invoiceId?: string | null }) =>
      fetchJson(`/api/jobs/${jobId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      refreshFinancials();
      setPayAmount("");
      setPayReference("");
      setPayInvoiceId("__none");
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePayment = useMutation({
    mutationFn: (paymentId: string) => fetchJson(`/api/payments/${paymentId}`, { method: "DELETE" }),
    onSuccess: () => {
      refreshFinancials();
      toast.success("Payment deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex flex-wrap gap-2">
            <Select value={payType} onValueChange={(v: string | null) => setPayType(v ?? "DEPOSIT")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue>{(v: string) => v?.replace("_", " ") || "Type"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEPOSIT">Deposit</SelectItem>
                <SelectItem value="PROGRESS">Progress</SelectItem>
                <SelectItem value="FINAL">Final</SelectItem>
                <SelectItem value="FINANCING_FUNDING">Financing</SelectItem>
              </SelectContent>
            </Select>
            <Select value={payMethod} onValueChange={(v: string | null) => setPayMethod(v ?? "CHECK")}>
              <SelectTrigger className="w-[130px]">
                <SelectValue>{(v: string) => v || "Method"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CHECK">Check</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="ACH">ACH</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="FINANCING">Financing</SelectItem>
                <SelectItem value="WIRE">Wire</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Amount" value={payAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)} className="w-[130px]" />
            <Input placeholder="Check # / ref." value={payReference} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayReference(e.target.value)} className="w-[160px]" />
            <Select value={payInvoiceId} onValueChange={(v: string | null) => setPayInvoiceId(v ?? "__none")}>
              <SelectTrigger className="w-[190px]">
                <SelectValue>{(v: string) => (v === "__none" || !v ? "Apply to invoice (optional)" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No invoice</SelectItem>
                {openInvoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — ${Number(inv.amount).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!payAmount || recordPayment.isPending}
              onClick={() =>
                recordPayment.mutate({
                  paymentType: payType,
                  amount: Number(payAmount),
                  method: payMethod,
                  reference: payReference,
                  invoiceId: payInvoiceId === "__none" ? null : payInvoiceId,
                })
              }
            >
              Record Payment
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {payments.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">{p.paymentType}</Badge>
                  {p.method && <Badge variant="secondary" className="text-xs">{p.method}</Badge>}
                  <span className="font-medium">${Number(p.amount).toLocaleString()}</span>
                  {p.reference && <span className="text-xs text-muted-foreground">#{p.reference}</span>}
                </div>
                {p.notes && <div className="mt-1 text-xs text-muted-foreground">{p.notes}</div>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {p.receivedDate ? format(new Date(p.receivedDate), "MMM d, yyyy") : p.status}
                {p.status === "RECEIVED" && (
                  <a href={`/api/payments/${p.id}/receipt`} target="_blank" rel="noopener noreferrer" className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">
                    Receipt PDF
                  </a>
                )}
                <button
                  onClick={() => {
                    if (confirm("Delete this payment? The balance will be recomputed.")) deletePayment.mutate(p.id);
                  }}
                  className="rounded border px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
        {payments.length === 0 && <EmptyState icon={Wallet} title="No payments recorded" description="Record the deposit or a progress payment above; the balance recomputes on save." />}
      </div>
    </div>
  );
}
