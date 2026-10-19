"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetch-json";
import type { EstimateRef } from "@/lib/estimates/job-from-estimate";
import { ESTIMATE_STATUS_LABEL, isEstimateStatus } from "@/lib/estimates/estimate-status";

type Option = { kind: "GENERIC" | "ROOF"; id: string; estimateNumber: string; name: string; status: string | null; totalPrice: number };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Inside the Won confirmation: which estimate the new job's price, cost and
 * budget come from. Preselects the accepted estimate, else the latest sent;
 * "No estimate" keeps the value typed on the lead. `value` undefined = not
 * loaded yet (the route then applies its own rule).
 */
export function WonEstimatePicker({
  leadId,
  leadValue,
  value,
  onChange,
}: {
  leadId: string;
  leadValue: number | null;
  value: EstimateRef | null | undefined;
  onChange: (v: EstimateRef | null) => void;
}) {
  const { data, isLoading, error } = useQuery<{ options: Option[]; preselect: EstimateRef | null }>({
    queryKey: ["won-estimates", leadId],
    queryFn: () => fetchJson(`/api/leads/${leadId}/won-estimates`),
  });

  useEffect(() => {
    if (data && value === undefined) onChange(data.preselect);
  }, [data, value, onChange]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Looking for this lead&apos;s estimates…</p>;
  if (error) return <p className="text-sm text-tone-danger-fg">{(error as Error).message}</p>;
  const options = data?.options ?? [];
  const isPicked = (o: Option) => value?.kind === o.kind && value?.id === o.id;

  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="mb-1 font-medium text-gray-900">The job&apos;s price, cost and budget come from</legend>
      {options.map((o) => (
        <label key={`${o.kind}:${o.id}`} className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand/5">
          <input type="radio" name="won-estimate" className="mt-1" checked={isPicked(o)} onChange={() => onChange({ kind: o.kind, id: o.id })} />
          <span className="min-w-0">
            <span className="font-medium">{o.estimateNumber}</span> · {o.name} · {money(o.totalPrice)}
            {o.status && isEstimateStatus(o.status) && <span className="text-muted-foreground"> · {ESTIMATE_STATUS_LABEL[o.status]}</span>}
          </span>
        </label>
      ))}
      <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand/5">
        <input type="radio" name="won-estimate" className="mt-1" checked={value === null} onChange={() => onChange(null)} />
        <span>No estimate — use the value on the lead{leadValue ? ` (${money(leadValue)})` : " ($0)"}</span>
      </label>
      <p className="text-xs text-muted-foreground">
        {options.length === 0
          ? "This lead has no estimate yet."
          : "The estimate is marked Accepted and kept as it is; its cost becomes the job's baseline and its sections the budget."}
      </p>
    </fieldset>
  );
}
