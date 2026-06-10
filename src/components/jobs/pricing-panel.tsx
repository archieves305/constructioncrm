"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type JobType = "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";
type MarginType = "PERCENT" | "FLAT";

type Job = {
  id: string;
  jobType: JobType;
  contractAmount: string;
  laborCost: string | null;
  marginType: MarginType | null;
  marginValue: string | null;
};

export function PricingPanel({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [jobType, setJobType] = useState<JobType>(job.jobType);
  const [contractAmount, setContractAmount] = useState(
    String(Number(job.contractAmount || 0)),
  );
  const [laborCost, setLaborCost] = useState(
    job.laborCost ? String(Number(job.laborCost)) : "",
  );
  const [marginType, setMarginType] = useState<MarginType>(
    job.marginType ?? "PERCENT",
  );
  const [marginValue, setMarginValue] = useState(
    job.marginValue ? String(Number(job.marginValue)) : "",
  );
  const [prevJobId, setPrevJobId] = useState(job.id);

  // When per-crew labor contracts exist, they own laborCost (the Labor tab
  // drives it), so the single labor field here is shown read-only.
  const isRollup = jobType === "COST_PLUS" || jobType === "OWNED_REHAB";
  const { data: laborContracts = [] } = useQuery<unknown[]>({
    queryKey: ["labor-contracts", job.id],
    queryFn: () =>
      fetch(`/api/jobs/${job.id}/labor-contracts`).then((r) => r.json()),
    enabled: isRollup,
  });
  const laborFromCrews = laborContracts.length > 0;
  // When crew-driven, show the live job value (kept in sync server-side) rather
  // than the local field state, which only resets on job change.
  const laborDisplay = laborFromCrews
    ? String(Number(job.laborCost ?? 0))
    : laborCost;

  if (prevJobId !== job.id) {
    setPrevJobId(job.id);
    setJobType(job.jobType);
    setContractAmount(String(Number(job.contractAmount || 0)));
    setLaborCost(job.laborCost ? String(Number(job.laborCost)) : "");
    setMarginType(job.marginType ?? "PERCENT");
    setMarginValue(job.marginValue ? String(Number(job.marginValue)) : "");
  }

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { jobType };
      if (jobType === "FIXED_PRICE") {
        body.contractAmount = Number(contractAmount) || 0;
      } else if (jobType === "OWNED_REHAB") {
        // When crew contracts own laborCost, don't overwrite it from here.
        if (!laborFromCrews) body.laborCost = Number(laborCost) || 0;
      } else {
        if (!laborFromCrews) body.laborCost = Number(laborCost) || 0;
        body.marginType = marginType;
        body.marginValue = Number(marginValue) || 0;
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", job.id] });
      qc.invalidateQueries({ queryKey: ["expenses", job.id] });
      toast.success("Pricing updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Pricing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <Label className="text-xs">Job type</Label>
          <Select
            value={jobType}
            onValueChange={(v: string | null) =>
              v && setJobType(v as JobType)
            }
          >
            <SelectTrigger>
              <SelectValue>
                {(v: string) =>
                  v === "COST_PLUS"
                    ? "Cost-plus"
                    : v === "OWNED_REHAB"
                      ? "Owned / Rehab (cost-only)"
                      : "Fixed price"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FIXED_PRICE">Fixed price</SelectItem>
              <SelectItem value="COST_PLUS">Cost-plus</SelectItem>
              <SelectItem value="OWNED_REHAB">
                Owned / Rehab (cost-only)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {jobType === "FIXED_PRICE" ? (
          <div>
            <Label className="text-xs">Contract amount ($)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={contractAmount}
              onChange={(e) => setContractAmount(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Profit = Contract − non-billable expenses
            </p>
          </div>
        ) : jobType === "OWNED_REHAB" ? (
          <div>
            <Label className="text-xs">Labor contract ($)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={laborDisplay}
              onChange={(e) => setLaborCost(e.target.value)}
              disabled={laborFromCrews}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {laborFromCrews
                ? "Set per crew in the Labor tab."
                : "Total cost = Labor contract + Expenses. No client billing."}
            </p>
          </div>
        ) : (
          <>
            <div>
              <Label className="text-xs">Labor cost ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={laborDisplay}
                onChange={(e) => setLaborCost(e.target.value)}
                disabled={laborFromCrews}
              />
              {laborFromCrews && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Set per crew in the Labor tab.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Margin type</Label>
                <Select
                  value={marginType}
                  onValueChange={(v: string | null) =>
                    v && setMarginType(v as MarginType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) => (v === "FLAT" ? "Flat $" : "Percent %")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Percent %</SelectItem>
                    <SelectItem value="FLAT">Flat $</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">
                  Margin {marginType === "FLAT" ? "($)" : "(%)"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step={marginType === "FLAT" ? "0.01" : "0.1"}
                  value={marginValue}
                  onChange={(e) => setMarginValue(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Contract = Labor + Expenses + Margin. Recalculates as you add
              expenses.
            </p>
          </>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save pricing"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
