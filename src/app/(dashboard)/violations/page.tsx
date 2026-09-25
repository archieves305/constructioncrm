"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardCheck, DollarSign, Gavel, Hourglass, Inbox, Plus, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useSession } from "@/lib/auth/session-client";
import { canCreateCase } from "@/lib/violations/access";
import { useViolationSummary } from "@/components/violations/use-violations";

/**
 * The landing page: one tile per queue, each opening the list it counts.
 * Stage 4 adds the report-driven breakdowns (by jurisdiction, category,
 * assignee) and the upcoming hearings/inspections cards here.
 */
export default function ViolationsOverviewPage() {
  const { data: session } = useSession();
  const { data, isLoading, error } = useViolationSummary();
  const canCreate = session ? canCreateCase(session.user.role) : false;
  return (
    <div>
      <PageHeader
        title="Code Violations"
        description="Notices, deadlines, fines and the corrective work — every case closes only on the agency's confirmation."
        actions={
          canCreate ? (
            <Button variant="brand" nativeButton={false} render={<Link href="/violations/new" />}>
              <Plus className="size-4" /> New case
            </Button>
          ) : undefined
        }
      />
      {error ? (
        <Callout tone="danger" title="Couldn't load the counts">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Open cases" value={data.open} icon={Gavel} href="/violations/list" />
          <KpiCard title="Overdue" value={data.overdue} icon={AlertTriangle} tone={data.overdue > 0 ? "danger" : undefined} href="/violations/list?view=overdue" />
          <KpiCard title="Due in 7 days" value={data.dueSoon} icon={CalendarClock} tone={data.dueSoon > 0 ? "warning" : undefined} href="/violations/list?view=due-soon" />
          <KpiCard title="Awaiting agency" value={data.awaitingAgency} icon={Hourglass} href="/violations/list?view=awaiting-agency" />
          <KpiCard title="Fines & liens" value={data.fines} icon={DollarSign} href="/violations/list?view=fines" description="Accruing, official balance or lien" />
          <KpiCard title="New / unreviewed" value={data.new} icon={Inbox} href="/violations/list?view=new" />
          <KpiCard title="Unassigned" value={data.unassigned} icon={UserX} tone={data.unassigned > 0 ? "warning" : undefined} href="/violations/list?caseManagerId=__unassigned" />
          <KpiCard title="My cases" value={data.mine} icon={UserCheck} href="/violations/list?view=mine" />
        </div>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/violations/inspections" className="flex items-center gap-3 rounded-lg border bg-white p-4 text-sm hover:bg-gray-50">
          <ClipboardCheck className="size-5 text-muted-foreground" />
          <span>
            <span className="font-medium">Inspections</span>
            <span className="block text-xs text-muted-foreground">Agency reinspections, date-first, with results to record.</span>
          </span>
        </Link>
        <Link href="/violations/hearings" className="flex items-center gap-3 rounded-lg border bg-white p-4 text-sm hover:bg-gray-50">
          <Gavel className="size-5 text-muted-foreground" />
          <span>
            <span className="font-medium">Hearings</span>
            <span className="block text-xs text-muted-foreground">Magistrate and board hearings, with outcomes to record.</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
