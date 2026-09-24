"use client";

import { differenceInCalendarDays } from "date-fns";
import { Clock, CornerDownRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskCountBadge } from "@/components/tasks/task-count-badge";
import { PermitBadge } from "./permit-badge";

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
  lead: { fullName: string; propertyAddress1?: string | null; city: string | null };
  salesRep: { id?: string; firstName: string; lastName: string } | null;
  projectManager?: { id?: string; firstName: string; lastName: string } | null;
  permits?: { status: string }[];
  taskCounts?: { pending: number; overdue: number };
  stageHistory?: { changedAt: string }[];
  updatedAt?: string;
};

const money0 = (n: unknown) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;

export function daysInStage(job: BoardJob, now = new Date()): number | null {
  const since = job.stageHistory?.[0]?.changedAt ?? job.updatedAt;
  if (!since) return null;
  return Math.max(0, differenceInCalendarDays(now, new Date(since)));
}

/** A job on the production board: readable sizes, one glance per fact. */
export function JobBoardCard({ job }: { job: BoardJob }) {
  const required = Number(job.depositRequired);
  const pct = required > 0 ? Math.round((Number(job.depositReceived) / required) * 100) : null;
  const days = daysInStage(job);
  const person = job.projectManager ?? job.salesRep;
  const permit = job.permits?.[0]?.status ?? null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{job.jobNumber}</span>
        <span className="text-sm font-semibold tabular-nums text-gray-900">{money0(job.contractAmount)}</span>
      </div>
      <p className="truncate text-sm font-medium leading-tight text-gray-900">{job.lead.fullName}</p>
      {(job.lead.propertyAddress1 || job.lead.city) && (
        <p className="truncate text-xs text-muted-foreground">
          {[job.lead.propertyAddress1, job.lead.city].filter(Boolean).join(", ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="text-[11px]">
          {job.serviceType}
        </Badge>
        {permit && <PermitBadge status={permit} />}
      </div>
      {job.nextAction && (
        <div className="flex items-start gap-1.5 rounded-md bg-tone-warning-soft px-2 py-1 text-xs leading-snug text-tone-warning-fg">
          <CornerDownRight className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2">{job.nextAction}</span>
        </div>
      )}
      {pct !== null && job.jobType !== "OWNED_REHAB" && (
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
        <span className="flex items-center gap-1">
          {days !== null && (
            <>
              <Clock className="size-3" /> {days}d in stage
            </>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {job.taskCounts && <TaskCountBadge open={job.taskCounts.pending} overdue={job.taskCounts.overdue} compact />}
          <UserAvatar user={person ?? null} size="sm" />
        </span>
      </div>
    </div>
  );
}
