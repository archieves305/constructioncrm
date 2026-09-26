"use client";

import { differenceInCalendarDays } from "date-fns";
import { Clock, CornerDownRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskCountBadge } from "@/components/tasks/task-count-badge";
import { jobLabel } from "@/lib/labels/job";
import { cn } from "@/lib/utils";
import { PermitBadge } from "./permit-badge";
import { PermitStatusPill, WorkflowIssueChips, type JobWorkflowSummaryData } from "@/components/workflows/job-workflow-summary";

export type BoardJob = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  jobType?: "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";
  contractAmount: string;
  depositReceived: string;
  depositRequired: string;
  nextAction: string | null;
  currentStageId?: string;
  currentStage: { id: string; name: string };
  lead: { fullName: string; propertyAddress1?: string | null; propertyAddress2?: string | null; city: string | null };
  salesRep: { id?: string; firstName: string; lastName: string } | null;
  projectManager?: { id?: string; firstName: string; lastName: string } | null;
  permits?: { status: string }[];
  taskCounts?: { pending: number; overdue: number };
  stageHistory?: { changedAt: string }[];
  updatedAt?: string;
  workflow?: JobWorkflowSummaryData | null;
};

const money0 = (n: unknown) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;

export function daysInStage(job: BoardJob, now = new Date()): number | null {
  const since = job.stageHistory?.[0]?.changedAt ?? job.updatedAt;
  if (!since) return null;
  return Math.max(0, differenceInCalendarDays(now, new Date(since)));
}

/**
 * A job on the production board: readable sizes, one glance per fact.
 * The address leads (it is how people know the job), the customer sits
 * under it, the number rides in the bottom row. Compact keeps the address,
 * amount, badges and the bottom row; the customer, phase text, next-action
 * callout and deposit bar go.
 */
export function JobBoardCard({ job, density = "comfortable" }: { job: BoardJob; density?: "comfortable" | "compact" }) {
  const compact = density === "compact";
  const required = Number(job.depositRequired);
  const pct = required > 0 ? Math.round((Number(job.depositReceived) / required) * 100) : null;
  const days = daysInStage(job);
  const person = job.projectManager ?? job.salesRep;
  const permit = job.permits?.[0]?.status ?? null;
  const label = jobLabel(job, { customer: false });

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("min-w-0 truncate text-sm font-medium leading-tight text-gray-900", label.placeholder && "italic")} title={label.primary}>
          {label.primary}
        </p>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{money0(job.contractAmount)}</span>
      </div>
      {!compact && <p className="truncate text-xs text-muted-foreground">{job.lead.fullName}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="text-[11px]">
          {job.serviceType}
        </Badge>
        {job.workflow ? <PermitStatusPill status={job.workflow.permitStatus} compact /> : permit && <PermitBadge status={permit} />}
        {compact && job.workflow && (
          <>
            <span className="text-[11px] tabular-nums text-muted-foreground" title={job.workflow.currentPhase?.name ?? "Workflow"}>
              {job.workflow.percentComplete}%
            </span>
            <WorkflowIssueChips summary={job.workflow} />
          </>
        )}
      </div>
      {!compact && job.workflow && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-muted-foreground" title={job.workflow.trades.map((t) => t.name).join(", ") || "Core only"}>
            {job.workflow.currentPhase?.name ?? (job.workflow.open === 0 ? "Workflow complete" : "Waiting")}
            <span className="ml-1 tabular-nums">{job.workflow.percentComplete}%</span>
          </span>
          <WorkflowIssueChips summary={job.workflow} />
        </div>
      )}
      {!compact && job.nextAction && (
        <div className="flex items-start gap-1.5 rounded-md bg-tone-warning-soft px-2 py-1 text-xs leading-snug text-tone-warning-fg">
          <CornerDownRight className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2">{job.nextAction}</span>
        </div>
      )}
      {!compact && pct !== null && job.jobType !== "OWNED_REHAB" && (
        <div className="flex items-center gap-2">
          <Progress
            value={pct}
            className="h-1.5 flex-1"
            indicatorClassName={pct >= 100 ? "bg-tone-success" : "bg-tone-warning"}
            label={`Deposit ${pct}%`}
          />
          <span className="text-[11px] tabular-nums text-muted-foreground">dep {pct}%</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[11px]">{job.jobNumber}</span>
          {days !== null && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {days}d
              {!compact && " in stage"}
            </span>
          )}
          {compact && job.nextAction && (
            <span className="flex items-center text-tone-warning-fg" title={job.nextAction}>
              <CornerDownRight className="size-3" />
            </span>
          )}
          {compact && pct !== null && pct < 100 && job.jobType !== "OWNED_REHAB" && <span className="tabular-nums">dep {pct}%</span>}
        </span>
        <span className="flex items-center gap-1.5">
          {job.taskCounts && <TaskCountBadge open={job.taskCounts.pending} overdue={job.taskCounts.overdue} compact />}
          <UserAvatar user={person ?? null} size="sm" />
        </span>
      </div>
    </div>
  );
}
