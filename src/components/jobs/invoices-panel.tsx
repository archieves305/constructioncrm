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

type Invoice = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  amount: string;
  status: "DRAFT" | "SENT" | "PAID" | "VOID";
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
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={inv.status}
                    onValueChange={(v: string | null) =>
                      v && updateStatus.mutate({ id: inv.id, status: v })
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
