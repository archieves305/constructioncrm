"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { CostSummary } from "@/lib/jobs/cost-summary";

const money = (n: number) => { const r = Math.round(n); return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`; };
const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

export function useJobCostSummary(jobId: string) {
  return useQuery<CostSummary>({
    // Under ["job", id]: payments, expenses, labor and contract changes all invalidate the job.
    queryKey: ["job", jobId, "cost-summary"],
    queryFn: () => fetchJson<CostSummary>(`/api/jobs/${jobId}/cost-summary`),
    retry: retryServerErrors,
  });
}

/**
 * Where the job stands on money: what it is worth, what it was expected to
 * cost, what has gone out, what is promised, and what is left. The same
 * figures Collections shows, from the same calculation.
 */
export function CostSummaryCard({ jobId, onOpenBudget, onOpenLabor }: { jobId: string; onOpenBudget?: () => void; onOpenLabor?: () => void }) {
  const { data: s, isLoading, error } = useJobCostSummary(jobId);

  if (isLoading) return <Skeleton className="mb-4 h-44 w-full" />;
  if (error || !s) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Cost summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {s.billable && (
            <dl className="space-y-1.5 text-sm">
              <Line label="Original contract" value={s.originalContract === null ? "—" : money(s.originalContract)} />
              <Line label="Approved change orders" value={money(s.approvedChangeOrders)} />
              {s.billableAddOns !== 0 && <Line label="Billable add-ons" value={money(s.billableAddOns)} />}
              <Line label="Revised contract" value={money(s.revisedContract)} strong />
              <Line label="Billed to date" value={money(s.billedToDate)} sub={`${money(s.collected)} collected`} />
            </dl>
          )}
          <dl className="space-y-1.5 text-sm">
            <Line
              label="Estimated cost"
              value={s.estimatedCost === null ? "No budget yet" : money(s.estimatedCost)}
              sub={
                s.estimatedCostSource === "budget" ? "From the job's budget"
                : s.estimatedCostSource === "estimate" ? "From the signed estimate — add a budget to refine it"
                : undefined
              }
              action={s.estimatedCostSource !== "budget" && onOpenBudget ? { label: "Add a budget", onClick: onOpenBudget } : undefined}
            />
            <Line
              label="Spent"
              value={money(s.spent)}
              sub="Labor paid, field labor and approved expenses"
              action={onOpenLabor ? { label: "View labor contracts and payments", onClick: onOpenLabor } : undefined}
            />
            <Line
              label="Committed"
              value={money(s.committed)}
              sub={s.committedOpen > 0 ? `Includes ${money(s.committedOpen)} of labor contracts not yet paid` : "Nothing promised beyond what is spent"}
              tone={s.overBudget ? "danger" : undefined}
            />
            <Line label="Remaining cost" value={money(s.remainingCost)} />
          </dl>
        </div>

        {s.billable && (
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
            <div>
              <p className="text-xs text-muted-foreground">
                {s.projectedProfit === null ? "Projected gross profit" : s.estimatedCost === null ? "Profit on costs so far" : "Projected gross profit"}
              </p>
              <p className={cn("text-xl font-semibold tabular-nums", (s.projectedProfit ?? 0) < 0 ? "text-tone-danger-fg" : "text-gray-900")}>
                {s.projectedProfit === null ? "—" : money(s.projectedProfit)}
                {s.projectedMargin !== null && <span className="ml-2 text-sm font-normal text-muted-foreground">{pct(s.projectedMargin)} margin</span>}
              </p>
            </div>
            <p className="max-w-xs text-right text-xs text-muted-foreground">
              {s.overBudget
                ? `Commitments are ${money(s.committed - (s.estimatedCost ?? 0))} over the estimated cost, so the projection uses them.`
                : s.projectedProfit === null
                  ? "Add a budget, or record costs, to see a projection."
                : s.estimatedCost === null
                  ? "With no budget this is the contract less costs so far, not a forecast."
                  : "Revised contract less the estimated cost."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Line({
  label, value, sub, strong, tone, action,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  tone?: "danger";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">
        {label}
        {sub && <span className="block text-[11px] leading-tight">{sub}</span>}
        {action && (
          <button type="button" onClick={action.onClick} className="block text-[11px] text-brand hover:underline">
            {action.label}
          </button>
        )}
      </dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "font-semibold text-gray-900" : "text-gray-900", tone === "danger" && "text-tone-danger-fg")}>{value}</dd>
    </div>
  );
}
