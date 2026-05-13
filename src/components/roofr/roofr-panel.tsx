"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Home, AlertTriangle } from "lucide-react";

type RoofrOrderStatus = "REQUESTED" | "COMPLETED" | "CANCELLED" | "FAILED";

type RoofrOrder = {
  id: string;
  status: RoofrOrderStatus;
  externalOrderId: string | null;
  reportUrl: string | null;
  notes: string | null;
  errorMessage: string | null;
  requestedAt: string;
  completedAt: string | null;
  createdBy: { firstName: string; lastName: string } | null;
};

const STATUS_VARIANTS: Record<RoofrOrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  REQUESTED: "secondary",
  COMPLETED: "default",
  CANCELLED: "outline",
  FAILED: "destructive",
};

export function RoofrPanel({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");

  const { data: orders, isLoading } = useQuery<RoofrOrder[]>({
    queryKey: ["roofr-orders", leadId],
    queryFn: () =>
      fetch(`/api/leads/${leadId}/roofr-orders`).then((r) => r.json()),
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/roofr-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      return body as RoofrOrder;
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["roofr-orders", leadId] });
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      setNotes("");
      if (order.status === "FAILED") {
        toast.error("Send to Roofr failed — see error on the order row.");
      } else {
        toast.success("Sent to Roofr — finish the order in Roofr to start the measurement");
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to order Roofr report: ${message}`);
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Send to Roofr</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates a Job + Customer in Roofr with this lead&apos;s address and
            contact info. <strong>You still need to click &ldquo;Order
            Report&rdquo; inside Roofr</strong> to actually start the
            measurement (Roofr charges per report, so the order step is
            manual). The completed report will appear here when Roofr finishes.
          </p>
          <Textarea
            placeholder="Optional notes for Roofr (rush, special requests, etc.)"
            value={notes}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setNotes(e.target.value)
            }
            rows={2}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={createOrder.isPending}
              onClick={() => createOrder.mutate()}
            >
              {createOrder.isPending ? "Sending..." : "Send to Roofr"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading orders...
        </p>
      ) : !orders?.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No Roofr orders yet
        </p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANTS[o.status]}>
                        {o.status}
                      </Badge>
                      {o.externalOrderId && (
                        <span className="text-xs text-muted-foreground">
                          Roofr #{o.externalOrderId}
                        </span>
                      )}
                    </div>
                    {o.notes && (
                      <p className="text-sm whitespace-pre-wrap">{o.notes}</p>
                    )}
                    {o.status === "FAILED" && o.errorMessage && (
                      <div className="flex items-start gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="break-words">{o.errorMessage}</span>
                      </div>
                    )}
                    {o.reportUrl && (
                      <a
                        href={o.reportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        View report <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    <div>
                      {format(new Date(o.requestedAt), "MMM d, h:mm a")}
                    </div>
                    {o.createdBy && (
                      <div>
                        {o.createdBy.firstName} {o.createdBy.lastName}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
