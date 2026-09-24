"use client";

import Link from "next/link";
import { AlertTriangle, Landmark, OctagonX, UserX } from "lucide-react";
import type { JobWorkflowSummary } from "@/lib/workflows/summary";
import { cn } from "@/lib/utils";
import { toneClasses } from "@/lib/ui/tones";
import { PERMIT_STATUS_LABEL, PERMIT_STATUS_TONE } from "./status";

/**
 * The per-job workflow line the jobs list, the production board and the
 * dashboard share: a permit pill, the current phase, and the three chips
 * that mean "look at this" — blocked, overdue, unassigned. Nothing renders
 * when there is nothing to say.
 */

export type JobWorkflowSummaryData = JobWorkflowSummary;

const SHORT_PERMIT: Record<JobWorkflowSummaryData["permitStatus"], string> = {
  UNDETERMINED: "Permit ?",
  REQUIRED: "Permit",
  NOT_REQUIRED: "No permit",
};

export function PermitStatusPill({
  status,
  compact = false,
  className,
}: {
  status: JobWorkflowSummaryData["permitStatus"] | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (!status) return null;
  return (
    <span
      title={PERMIT_STATUS_LABEL[status]}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        toneClasses(PERMIT_STATUS_TONE[status]).pill,
        className,
      )}
    >
      <Landmark className="size-3" />
      {compact ? SHORT_PERMIT[status] : PERMIT_STATUS_LABEL[status]}
    </span>
  );
}

export function WorkflowIssueChips({ summary, className }: { summary: JobWorkflowSummaryData | null | undefined; className?: string }) {
  if (!summary) return null;
  const chips: { key: string; n: number; label: string; icon: typeof AlertTriangle; cls: string }[] = [
    { key: "blocked", n: summary.blocked, label: summary.failedInspections > 0 ? "blocked (failed inspection)" : "blocked", icon: OctagonX, cls: toneClasses("danger").pill },
    { key: "overdue", n: summary.overdue, label: "overdue", icon: AlertTriangle, cls: toneClasses("warning").pill },
    { key: "unassigned", n: summary.unassigned, label: "unassigned", icon: UserX, cls: toneClasses("neutral").pill },
  ];
  const shown = chips.filter((c) => c.n > 0);
  if (shown.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((c) => (
        <span
          key={c.key}
          title={`${c.n} ${c.label} step${c.n === 1 ? "" : "s"}`}
          className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums", c.cls)}
        >
          <c.icon className="size-3" />
          {c.n}
        </span>
      ))}
    </span>
  );
}

/** "Permitting · 42%" with the issue chips. `—` for a job with no workflow. */
export function WorkflowPhaseCell({ jobId, summary }: { jobId: string; summary: JobWorkflowSummaryData | null | undefined }) {
  if (summary === undefined) return null;
  if (summary === null) return <span className="text-xs text-muted-foreground">—</span>;
  const phase = summary.currentPhase?.name ?? (summary.open === 0 ? "Complete" : "Waiting");
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/jobs/${jobId}?tab=workflow`}
        onClick={(e) => e.stopPropagation()}
        className="truncate text-sm hover:underline"
        title={summary.trades.length > 0 ? summary.trades.map((t) => t.name).join(", ") : "Core only"}
      >
        {phase}
        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{summary.percentComplete}%</span>
      </Link>
      <WorkflowIssueChips summary={summary} />
    </div>
  );
}

export function tradesLabel(summary: JobWorkflowSummaryData | null | undefined): string {
  if (!summary) return "";
  return summary.trades.length > 0 ? summary.trades.map((t) => t.name).join(", ") : "Core only";
}
