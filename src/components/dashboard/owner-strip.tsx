"use client";

import { useQuery } from "@tanstack/react-query";
import { Briefcase, FileText, PhoneOff, TrendingUp, UserPlus, Wallet } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { CollapsibleSection } from "@/components/shared/collapsible-section";
import { fetchJson } from "@/lib/fetch-json";
import { ownerSummaryIsEmpty, type OwnerSummary } from "@/lib/attention/rows";
import type { ListScope } from "@/lib/lists/scope";
import { useSession } from "@/lib/auth/session-client";
import { canViewCompanyFinancials } from "@/lib/money/access";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/**
 * The owner's first look: leads in, leads not called, what is in the
 * pipeline, estimates out, jobs running and the profit they are expected to
 * make. Each tile opens the list it counts. Shown to the financial-report
 * roles only; nobody else asks for it (the route would refuse them).
 * Compact, one row on a desktop, below the work to act on; when every figure
 * is zero it says so in a line instead of six zero tiles.
 */
export function OwnerStrip({ scope }: { scope: ListScope }) {
  const { data: session } = useSession();
  const allowed = canViewCompanyFinancials(session?.user.role);
  const { data } = useQuery<OwnerSummary>({
    queryKey: ["owner-summary", scope],
    queryFn: () => fetchJson(`/api/attention/owner?scope=${scope}`),
    enabled: allowed,
    retry: false,
    refetchInterval: 5 * 60_000,
  });
  if (!allowed || !data) return null;
  const gp = data.expectedGrossProfit;
  if (ownerSummaryIsEmpty(data)) {
    return (
      <CollapsibleSection id="dashboard-company" title="Company at a glance">
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Nothing to report yet: no new or open leads, estimates out or active jobs.</p>
      </CollapsibleSection>
    );
  }
  return (
    <CollapsibleSection id="dashboard-company" title="Company at a glance" summary={`${data.activeJobs} active job${data.activeJobs === 1 ? "" : "s"}, pipeline ${money(data.pipeline.value)}`}>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard compact title="New leads today" value={data.newLeadsToday} icon={UserPlus} href={`/leads?scope=${scope}`} />
      <KpiCard
        compact
        title="Never contacted"
        value={data.uncontacted}
        icon={PhoneOff}
        tone={data.uncontacted > 0 ? "danger" : undefined}
        href={`/attention/leads-uncontacted?scope=${scope}`}
        description="Open leads, nothing logged after a day"
      />
      <KpiCard compact title="Pipeline" value={money(data.pipeline.value)} icon={TrendingUp} href={`/leads?scope=${scope}`} description={`${data.pipeline.leads} open lead${data.pipeline.leads === 1 ? "" : "s"}, value as typed on each`} />
      <KpiCard
        compact
        title="Estimates out"
        value={money(data.estimatesOut.total)}
        icon={FileText}
        href={`/attention/estimates-outstanding?scope=${scope}`}
        description={`${data.estimatesOut.count} awaiting an answer`}
      />
      <KpiCard compact title="Active jobs" value={data.activeJobs} icon={Briefcase} href={`/jobs?scope=${scope}`} />
      <KpiCard
        compact
        title="Expected gross profit"
        value={money(gp.total)}
        icon={Wallet}
        tone={gp.total < 0 ? "danger" : undefined}
        href="/collections"
        description={`${gp.jobs} job${gp.jobs === 1 ? "" : "s"} with an expected cost${gp.jobsWithoutBaseline ? `; ${gp.jobsWithoutBaseline} without one not counted` : ""}`}
      />
    </div>
    </CollapsibleSection>
  );
}
