"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { JobCostSummaryResponse } from "@/lib/services/job-cost";

const money = (n: number) => { const r = Math.round(n); return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`; };
const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

export function useJobCostSummary(jobId: string, enabled = true) {
  return useQuery<JobCostSummaryResponse>({
    enabled,
    // Under ["job", id]: payments, expenses, labor and contract changes all invalidate the job.
    queryKey: ["job", jobId, "cost-summary"],
    queryFn: () => fetchJson<JobCostSummaryResponse>(`/api/jobs/${jobId}/cost-summary`),
    retry: retryServerErrors,
  });
}

/**
 * Where the job stands on money: what it is worth, what it was expected to
 * cost, what has gone out, what is promised, and what is left. The same
 * figures Collections shows, from the same calculation.
 */
export function CostSummaryCard({
  jobId,
  onOpenBudget,
  onOpenLabor,
  onOpenCommitments,
}: {
  jobId: string;
  onOpenBudget?: () => void;
  onOpenLabor?: () => void;
  onOpenCommitments?: () => void;
}) {
  const { data: s, isLoading, error } = useJobCostSummary(jobId);

  if (isLoading) return <Skeleton className="mb-4 h-44 w-full" />;
  if (error || !s) return null;
  // Our own flips and rentals: the estimated cost is their budget, and what matters is how far under or over it they are.
  const owned = !s.billable;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{owned ? "Budget and spend" : "Cost summary"}</CardTitle>
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
              label={owned ? "Budget" : "Estimated cost"}
              value={s.estimatedCost === null ? "No budget yet" : money(s.estimatedCost)}
              sub={
                owned ? (s.estimatedCostSource === "budget" ? "The rehab budget, plus approved change orders' cost" : s.estimatedCost === null ? undefined : "From the estimate — add a budget to refine it")
                : s.estimatedCostSource === "budget" ? "From the job's budget"
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
              sub={
                s.committedOpen > 0
                  ? `Includes ${[
                      s.laborCommittedOpen > 0 ? `${money(s.laborCommittedOpen)} of labor contracts not yet paid` : null,
                      s.commitmentsOpen > 0 ? `${money(s.commitmentsOpen)} of open commitments to vendors` : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")}`
                  : "Nothing promised beyond what is spent"
              }
              action={onOpenCommitments ? { label: "View commitments", onClick: onOpenCommitments } : undefined}
              tone={s.overBudget ? "danger" : undefined}
            />
            <Line label="Remaining cost" value={money(s.remainingCost)} />
          </dl>
          {owned && s.owned && <OwnedReturnsList s={s} />}
        </div>

        {s.billable && (
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
            <div>
              <p className="text-xs text-muted-foreground">
                {s.projectedProfit === null ? "Projected gross profit" : s.estimatedCost === null ? "Profit on costs so far" : "Projected gross profit"}
              </p>
              <p className={cn("text-xl font-semibold tabular-nums", (s.projectedProfit ?? 0) < 0 ? "text-tone-danger-fg" : "text-foreground")}>
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

/** One of our own projects: under or over the budget, what it all comes to, and what it returns. */
function OwnedReturnsList({ s }: { s: JobCostSummaryResponse }) {
  const r = s.owned!;
  const v = s.budgetVariance;
  return (
    <dl className="space-y-1.5 text-sm">
      <Line
        label={v === null ? "Under / over budget" : v >= 0 ? "Under budget" : "Over budget"}
        value={v === null ? "—" : money(Math.abs(v))}
        sub={v === null ? "Add a budget to measure against" : "Budget less what is spent and promised"}
        tone={v !== null && v < 0 ? "danger" : undefined}
        strong
      />
      <Line
        label="All-in cost"
        value={r.allIn === null ? "—" : money(r.allIn)}
        sub={r.allIn === null ? "Add the purchase price on the Property card" : `Purchase price + projected rehab · ${money(r.investedSoFar ?? 0)} in so far`}
      />
      {r.purpose === "FLIP" ? (
        <>
          <Line
            label={r.actualProfit !== null ? "Profit on the sale" : "Expected profit"}
            value={r.actualProfit !== null ? money(r.actualProfit) : r.expectedProfit === null ? "—" : money(r.expectedProfit)}
            sub={r.actualProfit !== null ? "Sale price less all-in cost" : r.expectedMargin !== null ? `${pct(r.expectedMargin)} of the after-repair value` : "Needs the purchase price and the after-repair value"}
            tone={(r.actualProfit ?? r.expectedProfit ?? 0) < 0 ? "danger" : undefined}
          />
        </>
      ) : (
        <Line
          label="Gross yield"
          value={r.grossYield === null ? "—" : pct(r.grossYield)}
          sub={r.annualRent === null ? "Needs the purchase price and the expected rent" : `${money(r.annualRent)} a year in rent, before expenses`}
        />
      )}
    </dl>
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
        {sub && <span className="block text-2xs leading-tight">{sub}</span>}
        {action && (
          <button type="button" onClick={action.onClick} className="block text-2xs text-brand hover:underline">
            {action.label}
          </button>
        )}
      </dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "font-semibold text-foreground" : "text-foreground", tone === "danger" && "text-tone-danger-fg")}>{value}</dd>
    </div>
  );
}
