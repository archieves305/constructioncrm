"use client";

import { useQuery } from "@tanstack/react-query";
import { Briefcase, FileText, PhoneOff, TrendingUp, UserPlus, Wallet } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { fetchJson } from "@/lib/fetch-json";
import type { OwnerSummary } from "@/lib/attention/rows";
import type { ListScope } from "@/lib/lists/scope";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/**
 * The owner's first look: leads in, leads not called, what is in the
 * pipeline, estimates out, jobs running and the profit they are expected to
 * make. Each tile opens the list it counts. Shown to the financial-report
 * roles; for anyone else the route refuses and the strip is left out.
 */
export function OwnerStrip({ scope }: { scope: ListScope }) {
  const { data } = useQuery<OwnerSummary>({
    queryKey: ["owner-summary", scope],
    queryFn: () => fetchJson(`/api/attention/owner?scope=${scope}`),
    retry: false,
    refetchInterval: 5 * 60_000,
  });
  if (!data) return null;
  const gp = data.expectedGrossProfit;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard title="New leads today" value={data.newLeadsToday} icon={UserPlus} href={`/leads?scope=${scope}`} />
      <KpiCard
        title="Never contacted"
        value={data.uncontacted}
        icon={PhoneOff}
        tone={data.uncontacted > 0 ? "danger" : undefined}
        href={`/attention/leads-uncontacted?scope=${scope}`}
        description="Open leads, nothing logged after a day"
      />
      <KpiCard title="Pipeline" value={money(data.pipeline.value)} icon={TrendingUp} href={`/leads?scope=${scope}`} description={`${data.pipeline.leads} open lead${data.pipeline.leads === 1 ? "" : "s"}, value as typed on each`} />
      <KpiCard
        title="Estimates out"
        value={money(data.estimatesOut.total)}
        icon={FileText}
        href={`/attention/estimates-outstanding?scope=${scope}`}
        description={`${data.estimatesOut.count} awaiting an answer`}
      />
      <KpiCard title="Active jobs" value={data.activeJobs} icon={Briefcase} href={`/jobs?scope=${scope}`} />
      <KpiCard
        title="Expected gross profit"
        value={money(gp.total)}
        icon={Wallet}
        tone={gp.total < 0 ? "danger" : undefined}
        href="/collections"
        description={`${gp.jobs} job${gp.jobs === 1 ? "" : "s"} with an expected cost${gp.jobsWithoutBaseline ? `; ${gp.jobsWithoutBaseline} without one not counted` : ""}`}
      />
    </div>
  );
}
