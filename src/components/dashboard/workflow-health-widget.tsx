"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PermitStatusPill } from "@/components/workflows/job-workflow-summary";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { WorkflowHealth } from "@/lib/workflows/reports";
import type { ListScope } from "@/lib/lists/scope";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/ui/tones";

/**
 * Dashboard card: how the live workflows are doing right now, and the five
 * jobs that most need someone. Every number links to the jobs list already
 * filtered to it, so the widget is a launchpad rather than a scoreboard.
 */
export function WorkflowHealthWidget({ className, scope = "all" }: { className?: string; scope?: ListScope }) {
  const q = `scope=${scope}`;
  const { data, isLoading, error } = useQuery<WorkflowHealth>({
    queryKey: ["workflow-health", scope],
    queryFn: () => fetchJson(`/api/reports?type=workflow-health&${q}`),
    retry: retryServerErrors,
    refetchInterval: 5 * 60_000,
  });

  const tiles: { label: string; value: number; href: string; tone: Tone; alwaysNeutralWhenZero?: boolean }[] = data
    ? [
        { label: "Active workflows", value: data.active, href: `/jobs?${q}`, tone: "info" },
        { label: "Ready steps", value: data.stepsReady, href: "/tasks?source=workflow&ready=1", tone: "info" },
        { label: "Overdue", value: data.stepsOverdue, href: `/jobs?workflowOverdue=1&${q}`, tone: "warning" },
        { label: "Blocked", value: data.stepsBlocked, href: `/jobs?workflowBlocked=1&${q}`, tone: "danger" },
        { label: "Unassigned", value: data.stepsUnassigned, href: `/jobs?workflowUnassigned=1&${q}`, tone: "neutral" },
        { label: "Permit undetermined", value: data.permitsUndetermined, href: `/jobs?permitStatus=UNDETERMINED&${q}`, tone: "warning" },
      ]
    : [];

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="size-4 text-muted-foreground" />
          Workflow health
          {data && data.jobsWithIssues > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              {data.jobsWithIssues} job{data.jobsWithIssues === 1 ? " needs" : "s need"} attention
            </span>
          )}
        </CardTitle>
        <Link href="/reports#workflow" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
          Report <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Couldn&apos;t load workflow health.</p>
        ) : !data || data.active === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No active workflows yet. Apply one from a job&apos;s Workflow tab.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {tiles.map((t) => {
                const quiet = t.value === 0;
                return (
                  <Link
                    key={t.label}
                    href={t.href}
                    className={cn(
                      "rounded-lg border px-3 py-2 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      !quiet && t.tone !== "info" && toneClasses(t.tone).soft,
                    )}
                  >
                    <div className={cn("text-xl font-semibold", !quiet && t.tone !== "info" && toneClasses(t.tone).text)}>{t.value}</div>
                    <div className="text-[11px] leading-tight text-muted-foreground">{t.label}</div>
                  </Link>
                );
              })}
            </div>
            {data.attention.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {data.attention.map((j) => (
                  <li key={j.jobId}>
                    <Link href={`/jobs/${j.jobId}?tab=workflow`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{j.address ?? j.customer ?? j.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {j.address && j.customer ? `${j.customer} · ` : ""}
                          {j.currentPhase ?? "Waiting"}
                        </span>
                      </span>
                      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">{j.jobNumber}</span>
                      <PermitStatusPill status={j.permitStatus} compact className="hidden sm:inline-flex" />
                      <span className="hidden w-24 items-center gap-2 md:flex">
                        <Progress value={j.percentComplete} className="h-1.5 flex-1" label={`${j.percentComplete}% complete`} />
                        <span className="text-[11px] tabular-nums text-muted-foreground">{j.percentComplete}%</span>
                      </span>
                      <span className="flex shrink-0 gap-1 text-[11px] font-medium tabular-nums">
                        {j.blocked > 0 && <span className={cn("rounded-md px-1.5 py-0.5", toneClasses("danger").pill)}>{j.blocked} blocked</span>}
                        {j.overdue > 0 && <span className={cn("rounded-md px-1.5 py-0.5", toneClasses("warning").pill)}>{j.overdue} overdue</span>}
                        {j.unassigned > 0 && <span className={cn("rounded-md px-1.5 py-0.5", toneClasses("neutral").pill)}>{j.unassigned} unassigned</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
