"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

type Job = {
  id: string;
  isRentalTurnover: boolean;
  priorTenantName: string | null;
  turnoverStartedAt: string | null;
  turnoverCompletedAt: string | null;
};

export function RentalTurnoverPanel({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [priorTenant, setPriorTenant] = useState(job.priorTenantName ?? "");
  const [prevJobId, setPrevJobId] = useState(job.id);

  if (prevJobId !== job.id) {
    setPrevJobId(job.id);
    setPriorTenant(job.priorTenantName ?? "");
  }

  const patchJob = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", job.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTurnover = (on: boolean) => {
    const patch: Record<string, unknown> = { isRentalTurnover: on };
    if (on && !job.turnoverStartedAt) {
      patch.turnoverStartedAt = new Date().toISOString();
    }
    patchJob.mutate(patch);
  };

  const markComplete = () => {
    patchJob.mutate({ turnoverCompletedAt: new Date().toISOString() });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Rental turnover
          </span>
          <Checkbox
            checked={job.isRentalTurnover}
            onCheckedChange={(c: boolean) => toggleTurnover(Boolean(c))}
            disabled={patchJob.isPending}
          />
        </CardTitle>
      </CardHeader>
      {job.isRentalTurnover && (
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Prior tenant</Label>
            <Input
              value={priorTenant}
              onChange={(e) => setPriorTenant(e.target.value)}
              onBlur={() => {
                if (priorTenant !== (job.priorTenantName ?? "")) {
                  patchJob.mutate({ priorTenantName: priorTenant || null });
                }
              }}
              placeholder="Prior tenant name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <Label className="text-xs text-muted-foreground">Started</Label>
              <div className="mt-1">
                {job.turnoverStartedAt
                  ? format(new Date(job.turnoverStartedAt), "MMM d, yyyy")
                  : "—"}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Completed</Label>
              <div className="mt-1">
                {job.turnoverCompletedAt
                  ? format(new Date(job.turnoverCompletedAt), "MMM d, yyyy")
                  : "—"}
              </div>
            </div>
          </div>

          {!job.turnoverCompletedAt && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={markComplete}
              disabled={patchJob.isPending}
            >
              Mark turnover complete
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
